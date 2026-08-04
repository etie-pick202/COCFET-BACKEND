import { TypeNotification } from '../entities/notification.entity';

/**
 * Envoi hors application (push mobile, plus tard SMS).
 *
 * La notification consultable dans l'application est une ligne en base, gérée
 * par le module lui-même ; ce port ne couvre que ce qui sort vers un
 * prestataire tiers, c'est-à-dire ce qui nous bloquerait sans compte ouvert.
 */
export interface CanalNotification {
  /**
   * Ne lève pas.
   *
   * Un push qui échoue ne doit pas faire échouer l'action métier : une
   * commande payée reste payée même si l'appareil du destinataire est
   * injoignable. Les erreurs sont journalisées, pas propagées.
   */
  diffuser(message: MessagePush): Promise<void>;
}

export interface MessagePush {
  destinataireId: string;
  type: TypeNotification;
  titre: string;
  corps: string;
  /** Route in-app à ouvrir au clic. */
  lien?: string | null;
}

export const CANAL_NOTIFICATION = Symbol('CanalNotification');
