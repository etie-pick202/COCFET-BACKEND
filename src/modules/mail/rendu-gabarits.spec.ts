import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import type { MailerOptions } from '@nestjs-modules/mailer';
import { join } from 'node:path';

/**
 * Rend les neuf gabarits comme le fera l'envoi réel.
 *
 * Ce n'est pas du zèle : le mode strict de Handlebars fait échouer le rendu sur
 * une variable citée mais absente du contexte, et cet échec ne se produit qu'au
 * moment de l'envoi — ni à la compilation, ni au démarrage. Sans cette
 * vérification, une faute de frappe dans un gabarit ne se découvrirait que le
 * jour où un utilisateur n'aurait pas reçu son message.
 *
 * Le même chemin que la production est emprunté : l'adaptateur du module de
 * courrier, le gabarit commun en enveloppe et le dossier des partiels.
 */
describe('Rendu des gabarits d’email', () => {
  const charte = {
    nom: 'Promotion ATLAS',
    annee: 2027,
    couleurPrimaire: '#123456',
    couleurSecondaire: '#abcdef',
    contrastePrimaire: '#FFFFFF',
  };

  const optionsMailer: MailerOptions = {
    template: {
      dir: join(__dirname, 'templates'),
      options: { strict: true },
    },
    options: {
      layout: 'gabarit',
      partials: {
        dir: join(__dirname, 'templates', 'partials'),
        options: { strict: true },
      },
    },
  };

  const adaptateur = new HandlebarsAdapter();

  const rendre = (
    template: string,
    contexte: Record<string, unknown>,
  ): Promise<string> =>
    new Promise((resoudre, rejeter) => {
      const message = { data: { template, context: { ...contexte, charte } } };

      adaptateur.compile(
        message,
        (erreur?: Error | null) => {
          if (erreur) {
            rejeter(erreur);
            return;
          }
          resoudre((message.data as { html?: string }).html ?? '');
        },
        optionsMailer,
      );
    });

  /** Un contexte par gabarit, identique à celui que passe `MailService`. */
  const contextes: Record<string, Record<string, unknown>> = {
    welcome: { prenom: 'Awa' },
    'password-reset': { prenom: 'Awa', resetUrl: 'https://cocfet.test/mdp' },
    'verification-email': {
      prenom: 'Awa',
      lienVerification: 'https://cocfet.test/verif',
    },
    'tentative-inscription': { prenom: 'Awa' },
    'changement-email': {
      prenom: 'Awa',
      lienConfirmation: 'https://cocfet.test/nouvelle',
    },
    'alerte-changement-email': {
      prenom: 'Awa',
      nouvelleAdresse: 'awa@exemple.test',
    },
    'invitation-sponsor': {
      nomSponsor: 'Société Générale',
      lienActivation: 'https://cocfet.test/partenaire',
    },
    notification: {
      prenom: 'Awa',
      titre: 'Nouvel article',
      message: 'Le bilan du mandat est en ligne.',
      lien: 'https://cocfet.test/articles/1',
    },
    'bienvenue-bureau': {
      prenom: 'Awa',
      poste: 'Trésorière',
      mandat: 'ATLAS',
      annee: 2027,
      mission: 'Tient les comptes du mandat.',
      administration: false,
    },
    billet: {
      prenom: 'Awa',
      titre: 'Gala des finissants',
      dateDebut: 'samedi 12 juin 2027 à 19:00',
      lieu: 'Campus UCAC-ICAM',
      codeBillet: 'BIL-4821',
      avecImage: true,
      tournant: false,
      sansControle: false,
    },
  };

  const noms = Object.keys(contextes);

  it('couvre les dix gabarits expédiés', () => {
    // Garde-fou : un gabarit ajouté sans contexte ici passerait entre les
    // mailles, et c'est précisément lui qui échouerait en production.
    expect(noms).toHaveLength(10);
  });

  it.each(noms)('rend « %s » sans variable manquante', async (nom) => {
    const html = await rendre(nom, contextes[nom]);

    expect(html).not.toContain('{{');
    expect(html.length).toBeGreaterThan(200);
  });

  it.each(noms)('habille « %s » aux couleurs du mandat', async (nom) => {
    const html = (await rendre(nom, contextes[nom])).toLowerCase();

    expect(html).toContain('promotion atlas');
    expect(html).toContain('#123456');
    // Une seule enveloppe : c'est tout l'objet du gabarit commun. Deux
    // `<html>` imbriqués, et les clients de messagerie rendent n'importe quoi.
    expect(html.split('<html').length - 1).toBe(1);
    expect(html.split('</body>').length - 1).toBe(1);
  });

  it.each([
    ['password-reset', 'https://cocfet.test/mdp'],
    ['verification-email', 'https://cocfet.test/verif'],
    ['changement-email', 'https://cocfet.test/nouvelle'],
    ['invitation-sponsor', 'https://cocfet.test/partenaire'],
    ['notification', 'https://cocfet.test/articles/1'],
  ])('porte le lien d’action de « %s »', async (nom, lien) => {
    // Le partiel reçoit son lien en paramètre nommé : une erreur de nom
    // rendrait un bouton vers nulle part, sans que rien n'échoue.
    const html = await rendre(nom, contextes[nom]);

    expect(html).toContain(`href="${lien}"`);
  });

  it('échoue bruyamment sur une variable absente', async () => {
    // Vérifie que le mode strict est bien en vigueur : c'est lui qui rend le
    // test précédent significatif.
    await expect(rendre('welcome', {})).rejects.toThrow(/prenom/);
  });

  it('n’annonce pas de billet joint quand il n’y en a pas', async () => {
    const html = await rendre('billet', {
      ...contextes.billet,
      avecImage: false,
      tournant: true,
    });

    expect(html).not.toContain('Votre QR code est joint');
    expect(html).toContain('toutes les 30 secondes');
  });
});
