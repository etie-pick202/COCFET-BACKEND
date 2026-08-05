import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';

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

  private async send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.mailerService.sendMail({ to, subject, template, context });
    } catch (error) {
      // Un échec d'envoi ne doit pas faire échouer l'action métier appelante.
      this.logger.error(
        `Échec de l'envoi de l'email "${template}" à ${to}`,
        error,
      );
    }
  }
}
