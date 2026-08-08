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
   * L'image voyage **dans** le message, référencée par `cid:` : une URL
   * distante serait bloquée par défaut chez Gmail et Outlook, et le
   * destinataire arriverait à l'entrée avec un cadre vide. Le code d'entrée
   * figure aussi en toutes lettres dans le gabarit, comme recours.
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
              cid: 'qrbillet',
            },
          ]
        : undefined,
    );
  }

  private async send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
    attachments?: { filename: string; content: Buffer; cid: string }[],
  ): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to,
        subject,
        template,
        context,
        ...(attachments ? { attachments } : {}),
      });
    } catch (error) {
      // Un échec d'envoi ne doit pas faire échouer l'action métier appelante.
      this.logger.error(
        `Échec de l'envoi de l'email "${template}" à ${to}`,
        error,
      );
    }
  }
}
