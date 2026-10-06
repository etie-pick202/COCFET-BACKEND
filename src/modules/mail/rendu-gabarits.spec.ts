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
    teinte: '#F7FAFD',
    bordTeinte: '#E1EDF8',
    logo: 'cid:logo@cocfet',
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
    surcharge: Record<string, unknown> = {},
  ): Promise<string> =>
    new Promise((resoudre, rejeter) => {
      const message = {
        data: {
          template,
          context: {
            ...contexte,
            charte,
            pied: { preferences: null },
            ...surcharge,
          },
        },
      };

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
    welcome: { prenom: 'Awa', lienPlateforme: 'https://cocfet.test/' },
    'password-reset': { prenom: 'Awa', resetUrl: 'https://cocfet.test/mdp' },
    'verification-email': {
      prenom: 'Awa',
      lienVerification: 'https://cocfet.test/verif',
    },
    'tentative-inscription': {
      prenom: 'Awa',
      lienConnexion: 'https://cocfet.test/connexion',
      lienMotDePasse: 'https://cocfet.test/mot-de-passe-oublie',
    },
    'changement-email': {
      prenom: 'Awa',
      lienConfirmation: 'https://cocfet.test/nouvelle',
    },
    'alerte-changement-email': {
      prenom: 'Awa',
      adresseActuelle: 'awa@ancienne.test',
      nouvelleAdresse: 'awa@exemple.test',
      lienMotDePasse: 'https://cocfet.test/mot-de-passe-oublie',
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
      libelleLien: 'Voir sur la plateforme',
      categorie: 'Actualité',
    },
    'bienvenue-bureau': {
      prenom: 'Awa',
      poste: 'Trésorière',
      mandat: 'ATLAS',
      annee: 2027,
      mission: 'Tient les comptes du mandat.',
      administration: false,
      lienProfil: 'https://cocfet.test/mon-espace/parametres',
    },
    billet: {
      prenom: 'Awa',
      titre: 'Gala des finissants',
      jour: 'Samedi 12 juin 2027',
      heure: '20 h 00',
      lieu: 'Campus UCAC-ICAM',
      codeBillet: 'BIL-4821',
      fixe: true,
      tournant: false,
      sansControle: false,
      qr: 'cid:qr@cocfet',
      lienBillet: 'https://cocfet.test/billets/7/qr',
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

  it('incruste le QR du billet fixe dans le corps', async () => {
    const html = await rendre('billet', contextes.billet);

    expect(html).toContain('src="cid:qr@cocfet"');
    expect(html).toContain('BIL-4821');
    expect(html).not.toContain('Afficher mon QR code');
  });

  it('mène tout billet à sa page, où se trouve aussi la facture', async () => {
    for (const regime of [
      { fixe: true, tournant: false, sansControle: false },
      { fixe: false, tournant: true, sansControle: false },
      { fixe: false, tournant: false, sansControle: true },
    ]) {
      const html = await rendre('billet', { ...contextes.billet, ...regime });

      expect(html).toContain('Voir mon billet et ma facture');
      expect(html).toContain('href="https://cocfet.test/billets/7/qr"');
    }
  });

  it('dit sur le bouton d’une notification où il mène', async () => {
    const html = await rendre('notification', {
      ...contextes.notification,
      lien: 'https://cocfet.test/commandes/9',
      libelleLien: 'Voir ma commande et ma facture',
    });

    expect(html).toContain('Voir ma commande et ma facture');
    expect(html).toContain('href="https://cocfet.test/commandes/9"');
  });

  it('mène le billet tournant à la plateforme, sans image', async () => {
    const html = await rendre('billet', {
      ...contextes.billet,
      fixe: false,
      tournant: true,
      qr: null,
    });

    expect(html).not.toContain('cid:qr@cocfet');
    expect(html).toContain('href="https://cocfet.test/billets/7/qr"');
    expect(html).toContain('toutes les 30 secondes');
  });

  it('pose le logo du mandat dans l’en-tête, et s’en passe s’il manque', async () => {
    const avec = await rendre('welcome', contextes.welcome);
    const sans = await rendre('welcome', contextes.welcome, {
      charte: { ...charte, logo: null },
    });

    expect(avec).toContain('src="cid:logo@cocfet"');
    expect(sans).not.toContain('<img');
    // Le nom du mandat reste, logo ou pas.
    expect(sans).toContain('Promotion ATLAS');
  });

  it('ne propose le lien des préférences qu’aux notifications', async () => {
    const lien = 'https://cocfet.test/mon-espace/parametres';
    const notification = await rendre('notification', contextes.notification, {
      pied: { preferences: lien },
    });
    const accueil = await rendre('welcome', contextes.welcome);

    expect(notification).toContain(`href="${lien}"`);
    expect(notification).toContain('Actualité');
    expect(accueil).not.toContain('Choisir les messages');
  });
});
