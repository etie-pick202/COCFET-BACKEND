import { Injectable, Logger } from '@nestjs/common';
import { CanalNotification, MessagePush } from '../ports/canal-notification';

/**
 * Canal de développement : les envois sont journalisés et conservés en
 * mémoire, aucun service externe n'est contacté.
 *
 * Les messages retenus permettent aux tests d'affirmer *qui* a été notifié et
 * *de quoi*, sans dépendre d'un prestataire.
 */
@Injectable()
export class CanalNotificationJournal implements CanalNotification {
  private readonly logger = new Logger(CanalNotificationJournal.name);

  /**
   * Borne volontaire : ce canal vit aussi longtemps que le processus. Sans
   * plafond, une file d'attente qui s'emballe finirait par consommer toute la
   * mémoire du serveur de développement.
   */
  private static readonly MAX_CONSERVES = 200;
  private readonly envoyes: MessagePush[] = [];

  diffuser(message: MessagePush): Promise<void> {
    this.envoyes.push(message);
    if (this.envoyes.length > CanalNotificationJournal.MAX_CONSERVES) {
      this.envoyes.shift();
    }

    this.logger.log(
      `Push simulé vers ${message.destinataireId} [${message.type}] ${message.titre}`,
    );

    return Promise.resolve();
  }

  /** Messages diffusés, du plus ancien au plus récent. Réservé aux tests. */
  historique(destinataireId?: string): MessagePush[] {
    return destinataireId
      ? this.envoyes.filter((m) => m.destinataireId === destinataireId)
      : [...this.envoyes];
  }

  vider(): void {
    this.envoyes.length = 0;
  }
}
