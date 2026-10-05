import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import {
  IdentiteVisuelle,
  IdentiteVisuelleService,
} from '../generation/identite-visuelle.service';
import { MailService } from './mail.service';

/** Laisse partir les promesses lancées sans être attendues. */
const viderLaFile = (): Promise<void> =>
  new Promise((resoudre) => setImmediate(resoudre));

/** Ce que `MailService` remet au module de courrier. */
interface MessageRemis {
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown> & { charte: Record<string, unknown> };
  attachments?: {
    filename: string;
    content: Buffer;
    cid?: string;
    decorative?: boolean;
  }[];
}

/** Signature PNG suivie de quelques octets : suffit à passer pour une image. */
const LOGO_PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('reste du logo'),
]);

describe('MailService', () => {
  let service: MailService;
  let sendMail: jest.Mock;
  let charte: jest.Mock;

  /** Le n-ième message remis, relu avec son type plutôt qu'en `any`. */
  const messageRemis = (index: number): MessageRemis =>
    (sendMail.mock.calls as MessageRemis[][])[index][0];

  const identite: IdentiteVisuelle = {
    nom: 'Promotion ATLAS',
    annee: 2027,
    couleurPrimaire: '#123456',
    couleurSecondaire: '#ABCDEF',
    contrastePrimaire: '#FFFFFF',
    logo: Buffer.from('des octets de logo'),
  };

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue(undefined);
    charte = jest.fn().mockResolvedValue(identite);

    service = new MailService(
      { sendMail } as unknown as MailerService,
      { charte } as unknown as IdentiteVisuelleService,
    );
  });

  it('pose la charte du mandat sur chaque message', async () => {
    await service.sendWelcome('awa@exemple.test', 'Awa');
    await viderLaFile();

    const message = messageRemis(0);

    expect(message.to).toBe('awa@exemple.test');
    expect(message.template).toBe('welcome');
    expect(message.context.prenom).toBe('Awa');
    expect(message.context.charte).toEqual({
      nom: 'Promotion ATLAS',
      annee: 2027,
      couleurPrimaire: '#123456',
      couleurSecondaire: '#ABCDEF',
      contrastePrimaire: '#FFFFFF',
      teinte: '#F7FAFD',
      bordTeinte: '#D9E9F8',
      // Les octets fournis ne sont pas une image : pas de logo, pas de cadre
      // cassé dans l'en-tête.
      logo: null,
    });
  });

  describe('liens des notifications', () => {
    // Un chemin relatif dans un email ne mène nulle part : il n'y a pas de
    // site autour pour le résoudre, et le bouton aboutissait à une 404.
    const avecFrontal = (origine: string): MailService =>
      new MailService(
        { sendMail } as unknown as MailerService,
        { charte } as unknown as IdentiteVisuelleService,
        { get: () => origine } as unknown as ConfigService,
      );

    it('ancre un chemin relatif sur le frontal', async () => {
      const mail = avecFrontal('https://cocfet.test,https://autre.test');

      await mail.envoyerNotification(
        'a@b.test',
        'Awa',
        'Commande prête',
        'Corps',
        '/commandes/42',
      );
      await viderLaFile();

      expect(messageRemis(0).context.lien).toBe(
        'https://cocfet.test/commandes/42',
      );
    });

    it('laisse passer un lien déjà absolu, et garde le nul', () => {
      const mail = avecFrontal('https://cocfet.test/');

      expect(mail.lienAbsolu('https://ailleurs.test/x')).toBe(
        'https://ailleurs.test/x',
      );
      expect(mail.lienAbsolu('billets/7')).toBe(
        'https://cocfet.test/billets/7',
      );
      expect(mail.lienAbsolu(null)).toBeNull();
    });
  });

  it('incruste le logo du mandat sans mettre ses octets dans le contexte', async () => {
    charte.mockResolvedValue({ ...identite, logo: LOGO_PNG });

    await service.sendWelcome('awa@exemple.test', 'Awa');
    await viderLaFile();

    const message = messageRemis(0);

    // Le gabarit ne voit qu'une référence ; l'image part en pièce jointe
    // incrustée, marquée décorative pour que l'API Brevo la retire.
    expect(message.context.charte.logo).toBe('cid:logo@cocfet');
    expect(message.attachments).toEqual([
      expect.objectContaining({
        content: LOGO_PNG,
        cid: 'logo@cocfet',
        decorative: true,
      }),
    ]);
  });

  it('écarte un logo qu’aucune messagerie n’afficherait', async () => {
    charte.mockResolvedValue({
      ...identite,
      logo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });

    await service.sendWelcome('awa@exemple.test', 'Awa');
    await viderLaFile();

    expect(messageRemis(0).context.charte.logo).toBeNull();
    expect(messageRemis(0)).not.toHaveProperty('attachments');
  });

  it('surtitre la notification et ouvre le lien des préférences', async () => {
    const mail = new MailService(
      { sendMail } as unknown as MailerService,
      { charte } as unknown as IdentiteVisuelleService,
      { get: () => 'https://cocfet.test' } as unknown as ConfigService,
    );

    await mail.envoyerNotification(
      'a@b.test',
      'Awa',
      'T',
      'C',
      null,
      'BOUTIQUE',
    );
    await mail.sendWelcome('a@b.test', 'Awa');
    await viderLaFile();

    expect(messageRemis(0).context.categorie).toBe('Boutique');
    expect(messageRemis(0).context.pied).toEqual({
      preferences: 'https://cocfet.test/mon-espace/parametres',
    });
    // Les autres messages ne se désactivent pas : pas de lien trompeur.
    expect(messageRemis(1).context.pied).toEqual({ preferences: null });
  });

  it('rend la main sans attendre le fournisseur', async () => {
    // L'envoi était autrefois attendu dans le chemin de la requête : une
    // panne du fournisseur déguisait l'inscription en lenteur de 122 s.
    let debloquer: () => void = () => {};
    sendMail.mockReturnValue(
      new Promise<void>((resoudre) => {
        debloquer = resoudre;
      }),
    );

    await expect(
      service.sendWelcome('awa@exemple.test', 'Awa'),
    ).resolves.toBeUndefined();

    debloquer();
  });

  it('n’échoue pas quand le fournisseur refuse le message', async () => {
    sendMail.mockRejectedValue(new Error('clé refusée'));

    await expect(
      service.sendWelcome('awa@exemple.test', 'Awa'),
    ).resolves.toBeUndefined();
    await viderLaFile();
  });

  it.each([
    ['welcome', () => service.sendWelcome('a@b.test', 'Awa')],
    [
      'password-reset',
      () => service.sendPasswordReset('a@b.test', 'Awa', 'https://x.test/mdp'),
    ],
    [
      'verification-email',
      () =>
        service.envoyerVerificationEmail('a@b.test', 'Awa', 'https://x.test/v'),
    ],
    [
      'tentative-inscription',
      () => service.envoyerTentativeInscription('a@b.test', 'Awa'),
    ],
    [
      'notification',
      () =>
        service.envoyerNotification('a@b.test', 'Awa', 'Titre', 'Corps', null),
    ],
    [
      'changement-email',
      () =>
        service.envoyerConfirmationNouvelleAdresse(
          'a@b.test',
          'Awa',
          'https://x.test/c',
        ),
    ],
    [
      'alerte-changement-email',
      () => service.envoyerAlerteChangementEmail('a@b.test', 'Awa', 'n@b.test'),
    ],
    [
      'invitation-sponsor',
      () =>
        service.envoyerInvitationSponsor('a@b.test', 'Société', 'https://x/a'),
    ],
  ])('habille « %s » de la charte', async (gabarit, envoyer) => {
    // Aucun appelant n'a à y penser : la charte est posée par `send`, donc
    // par tous les envois sans exception.
    await envoyer();
    await viderLaFile();

    const message = messageRemis(0);

    expect(message.template).toBe(gabarit);
    expect(message.context.charte).toMatchObject({ nom: 'Promotion ATLAS' });
  });

  it('incruste le QR code du billet fixe, sans l’exiger', async () => {
    const billet = {
      id: '0b8e2c55-6f1d-4a57-9d4e-3a2b1c0d9e8f',
      titre: 'Gala des finissants',
      dateDebut: new Date('2027-06-12T19:00:00Z'),
      lieu: 'Campus UCAC-ICAM',
      codeBillet: 'BIL-4821',
      qrPng: Buffer.from('png'),
      modeAcces: 'QR_FIXE' as const,
    };

    await service.envoyerBillet('awa@exemple.test', 'Awa', billet);
    await viderLaFile();
    await service.envoyerBillet('awa@exemple.test', 'Awa', {
      ...billet,
      qrPng: null,
      modeAcces: 'QR_TOURNANT',
    });
    await viderLaFile();

    expect(messageRemis(0).attachments).toEqual([
      expect.objectContaining({
        cid: 'qr@cocfet',
        filename: 'billet-BIL-4821.png',
      }),
    ]);
    expect(messageRemis(0).context).toMatchObject({
      qr: 'cid:qr@cocfet',
      fixe: true,
      // 19 h UTC, 20 h à Douala : l'heure annoncée est celle du lieu.
      jour: 'Samedi 12 juin 2027',
      heure: '20 h 00',
    });

    expect(messageRemis(1)).not.toHaveProperty('attachments');
    expect(messageRemis(1).context).toMatchObject({
      qr: null,
      tournant: true,
      lienBillet:
        'http://localhost:5173/billets/0b8e2c55-6f1d-4a57-9d4e-3a2b1c0d9e8f/qr',
    });
  });
});
