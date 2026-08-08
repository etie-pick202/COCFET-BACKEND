import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Régime de contrôle à l'entrée, décrit ici en union de chaînes.
 *
 * Le service de mail n'importe pas l'énumération du module événement : il
 * n'écrit que du texte, et lui faire connaître le domaine le rendrait
 * dépendant d'un module qu'il n'a aucune raison de charger.
 */
export type ModeAcces = 'AUCUN' | 'QR_FIXE' | 'QR_TOURNANT';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendWelcome(to: string, prenom: string): Promise<void> {
    await this.send(to, 'Bienvenue sur COCFET', 'welcome', { prenom });
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
      { prenom },
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
  ): Promise<void> {
    await this.send(to, `${titre} — COCFET`, 'notification', {
      prenom,
      titre,
      message,
      lien,
    });
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
      { prenom, nouvelleAdresse },
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
   * Envoie le billet, QR code compris.
   *
   * Le QR voyage **dans** le message, en pièce jointe : une URL distante
   * serait bloquée par défaut chez Outlook, et le destinataire arriverait à
   * l'entrée avec un cadre vide.
   *
   * Il était auparavant affiché dans le corps via `cid:`. L'API HTTP de Brevo
   * ne sait pas rattacher une pièce jointe à un `Content-Id` — seul le relais
   * SMTP le permettait, et il est injoignable depuis l'hébergeur. Le fichier
   * est donc joint, et le gabarit dirige vers lui. Le code d'entrée figure de
   * toute façon en toutes lettres, comme recours.
   */
  async envoyerBillet(
    to: string,
    prenom: string,
    billet: {
      titre: string;
      dateDebut: Date;
      lieu: string;
      codeBillet: string;
      /** Absent quand l'événement ne remet pas d'image à conserver. */
      qrPng: Buffer | null;
      modeAcces: ModeAcces;
    },
  ): Promise<void> {
    await this.send(
      to,
      billet.modeAcces === 'AUCUN'
        ? `Inscription confirmée — ${billet.titre}`
        : `Votre billet — ${billet.titre}`,
      'billet',
      {
        prenom,
        titre: billet.titre,
        dateDebut: billet.dateDebut.toLocaleString('fr-FR', {
          dateStyle: 'full',
          timeStyle: 'short',
        }),
        lieu: billet.lieu,
        codeBillet: billet.codeBillet,
        // Trois variables plutôt qu'une : Handlebars ne compare pas, il teste
        // la véracité. Toutes sont passées, le mode strict faisant échouer le
        // rendu sur une variable citée mais absente.
        avecImage: billet.qrPng !== null,
        tournant: billet.modeAcces === 'QR_TOURNANT',
        sansControle: billet.modeAcces === 'AUCUN',
      },
      billet.qrPng
        ? [
            {
              filename: `billet-${billet.codeBillet}.png`,
              content: billet.qrPng,
            },
          ]
        : undefined,
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
   */
  private send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
    attachments?: { filename: string; content: Buffer }[],
  ): Promise<void> {
    void this.mailerService
      .sendMail({
        to,
        subject,
        template,
        context,
        ...(attachments ? { attachments } : {}),
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
