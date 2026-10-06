import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentiteVisuelleService } from '../generation/identite-visuelle.service';
import { CID_QR, PieceJointeMail, preparerCharte } from './charte-email';

/**
 * Régime de contrôle à l'entrée, décrit ici en union de chaînes.
 *
 * Le service de mail n'importe pas l'énumération du module événement : il
 * n'écrit que du texte, et lui faire connaître le domaine le rendrait
 * dépendant d'un module qu'il n'a aucune raison de charger.
 */
export type ModeAcces = 'AUCUN' | 'QR_FIXE' | 'QR_TOURNANT';

/**
 * Surtitre d'une notification, selon son type.
 *
 * Indexé par chaîne pour la même raison que {@link ModeAcces} : le courrier
 * n'a pas à connaître l'énumération du module de notification. Un type absent
 * de la table donne un message sans surtitre, jamais une erreur.
 */
const CATEGORIES_NOTIFICATION: Record<string, string> = {
  EVENEMENT: 'Événement',
  PAIEMENT: 'Paiement',
  SONDAGE: 'Sondage',
  ARTICLE: 'Actualité',
  BOUTIQUE: 'Boutique',
  RAPPEL: 'Rappel',
  SYSTEME: 'Plateforme',
};

/**
 * Fuseau des événements. Le serveur tourne en UTC : sans fuseau explicite, un
 * gala à 18 h à Douala s'annoncerait à 17 h.
 */
const FUSEAU = 'Africa/Douala';

/** Options d'un envoi, au-delà du gabarit et de son contexte. */
interface OptionsEnvoi {
  pieces?: PieceJointeMail[];
  /** Ajoute au pied le lien vers les préférences de notification. */
  avecPreferences?: boolean;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** Adresse du frontal, sans barre finale : la base des liens absolus. */
  private readonly urlFrontal: string;

  constructor(
    private readonly mailerService: MailerService,
    private readonly identiteVisuelle: IdentiteVisuelleService,
    @Optional() config?: ConfigService,
  ) {
    // Même source que les liens d'authentification et le retour de paiement :
    // la première origine autorisée est l'adresse du frontal.
    let base = (
      config?.get<string>('CORS_ORIGIN', 'http://localhost:5173') ??
      'http://localhost:5173'
    )
      .split(',')[0]
      .trim();
    while (base.endsWith('/')) {
      base = base.slice(0, -1);
    }
    this.urlFrontal = base;
  }

  /**
   * Rend un lien de notification utilisable depuis une messagerie.
   *
   * Les notifications portent des chemins relatifs (`/commandes/…`) : dans
   * l'application, le navigateur les résout contre le site. Dans un email, il
   * n'y a pas de site autour — le bouton « Voir sur la plateforme » menait à
   * une page introuvable. On les ancre donc sur l'adresse du frontal ; un lien
   * déjà absolu passe tel quel.
   */
  lienAbsolu(lien: string | null): string | null {
    if (!lien) {
      return null;
    }
    if (/^https?:\/\//i.test(lien)) {
      return lien;
    }
    return `${this.urlFrontal}/${lien.replace(/^\/+/, '')}`;
  }

  /** Chemin du frontal rendu absolu : `/connexion` → `https://…/connexion`. */
  private page(chemin: string): string {
    return `${this.urlFrontal}${chemin}`;
  }

  async sendWelcome(to: string, prenom: string): Promise<void> {
    await this.send(to, 'Bienvenue sur COCFET', 'welcome', {
      prenom,
      lienPlateforme: this.page('/'),
    });
  }

  async sendPasswordReset(
    to: string,
    prenom: string,
    resetUrl: string,
  ): Promise<void> {
    await this.send(
      to,
      'Réinitialisation de votre mot de passe',
      'password-reset',
      {
        prenom,
        resetUrl,
      },
    );
  }

  async envoyerVerificationEmail(
    to: string,
    prenom: string,
    lienVerification: string,
  ): Promise<void> {
    await this.send(
      to,
      'Confirmez votre adresse — COCFET',
      'verification-email',
      { prenom, lienVerification },
    );
  }

  /**
   * Prévient le titulaire d'un compte déjà actif qu'une inscription a été
   * tentée avec son adresse. C'est ce qui permet de renvoyer la même réponse
   * dans tous les cas sans laisser la tentative passer inaperçue.
   */
  async envoyerTentativeInscription(to: string, prenom: string): Promise<void> {
    await this.send(
      to,
      'Tentative d’inscription avec votre adresse — COCFET',
      'tentative-inscription',
      {
        prenom,
        lienConnexion: this.page('/connexion'),
        lienMotDePasse: this.page('/mot-de-passe-oublie'),
      },
    );
  }

  /**
   * Message générique adossé à une notification.
   *
   * `lien` est passé même absent : l'adaptateur Handlebars est en mode strict,
   * et une variable référencée par le gabarit mais manquante du contexte fait
   * échouer le rendu — au moment de l'envoi, jamais à la compilation.
   */
  async envoyerNotification(
    to: string,
    prenom: string,
    titre: string,
    message: string,
    lien: string | null,
    type?: string,
    libelleLien?: string | null,
  ): Promise<void> {
    await this.send(
      to,
      `${titre} — COCFET`,
      'notification',
      {
        prenom,
        titre,
        message,
        lien: this.lienAbsolu(lien),
        // Le bouton dit où il mène : « Voir mon billet et ma facture » parle
        // mieux qu'un « Voir sur la plateforme » qui ne dit rien de la page.
        // Passé même absent : le mode strict de Handlebars refuse une variable
        // citée par le gabarit mais manquante du contexte.
        libelleLien: libelleLien || 'Voir sur la plateforme',
        categorie: (type && CATEGORIES_NOTIFICATION[type]) || null,
      },
      // Ces messages sont les seuls que l'on peut couper : le pied dit où.
      { avecPreferences: true },
    );
  }

  /** Part vers la **nouvelle** adresse : c'est elle qu'il faut prouver. */
  async envoyerConfirmationNouvelleAdresse(
    to: string,
    prenom: string,
    lienConfirmation: string,
  ): Promise<void> {
    await this.send(
      to,
      'Confirmez votre nouvelle adresse — COCFET',
      'changement-email',
      { prenom, lienConfirmation },
    );
  }

  /**
   * Prévient l'ancienne adresse qu'un changement a été demandé.
   *
   * C'est le filet qui permet au titulaire légitime de réagir : sans lui, une
   * prise de contrôle du compte se terminerait par un changement d'identifiant
   * dont il ne saurait rien.
   */
  async envoyerAlerteChangementEmail(
    to: string,
    prenom: string,
    nouvelleAdresse: string,
  ): Promise<void> {
    await this.send(
      to,
      'Changement d’adresse demandé — COCFET',
      'alerte-changement-email',
      {
        prenom,
        adresseActuelle: to,
        nouvelleAdresse,
        // La réinitialisation, et non le changement depuis le profil : elle
        // n'exige pas l'ancien mot de passe, que l'intrus a peut-être changé.
        lienMotDePasse: this.page('/mot-de-passe-oublie'),
      },
    );
  }

  /**
   * Accueille un membre fraîchement désigné à un poste du bureau.
   *
   * Le message dit le poste **et** le mandat : « Trésorière » seul ne signifie
   * rien pour qui reçoit trois emails de trois associations. Il prévient aussi
   * quand le poste ouvre l'administration, et que la session en cours ne porte
   * pas encore ces droits — sinon la personne conclut à une panne.
   */
  async envoyerBienvenueAuBureau(
    to: string,
    prenom: string,
    affectation: {
      poste: string;
      mandat: string;
      annee: number | null;
      /** Description du poste au catalogue, quand le bureau en a rédigé une. */
      mission: string | null;
      administration: boolean;
    },
  ): Promise<void> {
    await this.send(
      to,
      `Bienvenue au bureau — ${affectation.poste} ${affectation.mandat}`,
      'bienvenue-bureau',
      {
        prenom,
        poste: affectation.poste,
        mandat: affectation.mandat,
        annee: affectation.annee,
        mission: affectation.mission,
        administration: affectation.administration,
        lienProfil: this.page('/mon-espace/parametres'),
      },
    );
  }

  async envoyerInvitationSponsor(
    to: string,
    nomSponsor: string,
    lienActivation: string,
  ): Promise<void> {
    await this.send(
      to,
      'Votre accès partenaire — COCFET',
      'invitation-sponsor',
      { nomSponsor, lienActivation },
    );
  }

  /**
   * Envoie le billet.
   *
   * Sous `QR_FIXE`, le QR voyage **dans** le corps du message, en image
   * incrustée (`cid:`) : une URL distante serait bloquée par défaut chez
   * Outlook, et Gmail supprime les sources `data:`. Par le relais SMTP, il
   * s'affiche donc sans réseau une fois l'email ouvert. Par l'API HTTP de
   * Brevo, qui ne sait pas incruster, il part en pièce jointe ; la référence
   * figure de toute façon en toutes lettres, comme recours.
   *
   * Sous `QR_TOURNANT`, aucune image : elle périmerait en trente secondes. Le
   * message mène à la page du billet, qui affiche le code courant.
   */
  async envoyerBillet(
    to: string,
    prenom: string,
    billet: {
      /** Identifiant de l'inscription : celui de la page du billet. */
      id: string;
      titre: string;
      dateDebut: Date;
      lieu: string;
      codeBillet: string;
      /** Absent quand l'événement ne remet pas d'image à conserver. */
      qrPng: Buffer | null;
      modeAcces: ModeAcces;
    },
  ): Promise<void> {
    const jour = billet.dateDebut.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: FUSEAU,
    });
    const heure = billet.dateDebut
      .toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: FUSEAU,
      })
      .replace(':', ' h ');

    await this.send(
      to,
      billet.modeAcces === 'AUCUN'
        ? `Inscription confirmée — ${billet.titre}`
        : `Votre billet — ${billet.titre}`,
      'billet',
      {
        prenom,
        titre: billet.titre,
        jour: jour.charAt(0).toUpperCase() + jour.slice(1),
        heure,
        lieu: billet.lieu,
        codeBillet: billet.codeBillet,
        // Trois variables plutôt qu'une : Handlebars ne compare pas, il teste
        // la véracité. Toutes sont passées, le mode strict faisant échouer le
        // rendu sur une variable citée mais absente.
        fixe: billet.modeAcces === 'QR_FIXE',
        tournant: billet.modeAcces === 'QR_TOURNANT',
        sansControle: billet.modeAcces === 'AUCUN',
        qr: billet.qrPng ? `cid:${CID_QR}` : null,
        lienBillet: this.page(`/billets/${billet.id}/qr`),
      },
      {
        pieces: billet.qrPng
          ? [
              {
                filename: `billet-${billet.codeBillet}.png`,
                content: billet.qrPng,
                contentType: 'image/png',
                cid: CID_QR,
              },
            ]
          : [],
      },
    );
  }

  /**
   * Remet le message au fournisseur **sans faire attendre l'appelant**.
   *
   * L'envoi était auparavant attendu dans le chemin de la requête. Quand le
   * fournisseur ne répondait plus, l'inscription mettait 122 s à répondre — et
   * répondait quand même « un email vient d'y être envoyé », l'erreur étant
   * avalée. La panne se déguisait ainsi en lenteur.
   *
   * Aucun appelant n'exploite le résultat : l'échec d'un envoi n'a jamais dû
   * faire échouer l'action métier. On rend donc la main tout de suite, et
   * l'issue part dans les journaux. Le transport, lui, borne sa propre attente.
   *
   * La charte est lue ici, hors du chemin de la requête, et non par chaque
   * appelant : c'est la seule façon de garantir qu'aucun message ne parte sans
   * elle. Le service la garde en cache, la lecture est donc gratuite après le
   * premier envoi, et elle ne lève jamais.
   */
  private send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
    options: OptionsEnvoi = {},
  ): Promise<void> {
    void this.identiteVisuelle
      .charte()
      .then((identite) => {
        // Le gabarit commun lit `charte` pour son en-tête et ses boutons. Le
        // logo y figure sous forme de référence `cid:` ; ses octets partent en
        // pièce jointe incrustée, jamais dans le contexte de rendu.
        const { charte, logo } = preparerCharte(identite);
        const attachments = [
          ...(logo ? [logo] : []),
          ...(options.pieces ?? []),
        ];

        return this.mailerService.sendMail({
          to,
          subject,
          template,
          context: {
            ...context,
            charte,
            pied: {
              preferences: options.avecPreferences
                ? this.page('/mon-espace/parametres')
                : null,
            },
          },
          ...(attachments.length > 0 ? { attachments } : {}),
        });
      })
      .then(() => {
        this.logger.log(`Email "${template}" remis au fournisseur pour ${to}.`);
      })
      .catch((error: unknown) => {
        // Journalisé en `error` avec le motif rendu par le transport : c'est
        // ce message qui dit si la clé est refusée, l'expéditeur non validé ou
        // le quota dépassé.
        this.logger.error(
          `Échec de l'envoi de l'email "${template}" à ${to} : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return Promise.resolve();
  }
}
