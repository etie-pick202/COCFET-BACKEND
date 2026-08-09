import { MailerService } from '@nestjs-modules/mailer';
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
  attachments?: { filename: string; content: Buffer }[];
}

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
    });
  });

  it('laisse le logo hors du contexte de rendu', async () => {
    // Il ne s'affiche pas dans un email — voir l'en-tête de « gabarit.hbs ».
    // Ses octets n'ont donc rien à faire dans un contexte Handlebars.
    await service.sendWelcome('awa@exemple.test', 'Awa');
    await viderLaFile();

    expect(messageRemis(0).context.charte).not.toHaveProperty('logo');
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

  it('joint le QR code au billet, sans l’exiger', async () => {
    const billet = {
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

    expect(messageRemis(0).attachments).toHaveLength(1);
    expect(messageRemis(1)).not.toHaveProperty('attachments');
  });
});
