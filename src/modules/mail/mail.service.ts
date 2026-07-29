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
