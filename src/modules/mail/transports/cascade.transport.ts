import { Logger } from '@nestjs/common';

/**
 * Transport nodemailer qui essaie plusieurs voies d'envoi, l'une après
 * l'autre, jusqu'à ce que l'une d'elles remette le message.
 *
 * L'ordre habituel : le relais SMTP d'abord — seul capable d'incruster le logo
 * du mandat et le QR code des billets dans le corps —, puis un relais de
 * secours (le compte d'un autre fournisseur), puis l'API HTTP de Brevo. Une
 * voie en panne ne doit jamais suffire à priver quelqu'un de son billet ou de
 * son code de connexion : le message part par la suivante, au pire sans
 * images incrustées.
 *
 * **Quota épuisé.** La cause la plus fréquente d'une panne d'envoi est le
 * plafond du fournisseur (nombre de mails par jour ou par mois). Tant qu'il
 * dure, chaque message perdrait du temps à frapper à une porte fermée : la
 * voie est alors mise de côté {@link PAUSE_APRES_QUOTA_MS}, et les messages
 * partent directement par la suivante. Les autres échecs (réseau, délai
 * dépassé) ne suspendent rien : ils sont souvent passagers.
 */

interface MessageNodemailer {
  data: Record<string, unknown>;
}

type Rappel = (erreur: Error | null, info?: { messageId: string }) => void;

/** Ce que renvoie une voie qui a remis le message. */
export interface Remise {
  messageId?: string;
}

export interface Voie {
  /** Nom lisible, pour les journaux : « Relais SMTP smtp.exemple.com ». */
  nom: string;
  envoyer(donnees: Record<string, unknown>): Promise<Remise>;
}

/** Temps pendant lequel une voie au quota épuisé est laissée de côté. */
export const PAUSE_APRES_QUOTA_MS = 15 * 60 * 1000;

/**
 * Vrai quand l'erreur dit que le plafond d'envoi du fournisseur est atteint.
 *
 * Reconnue à ses mots, faute de code commun : chaque fournisseur formule le
 * refus à sa manière (« daily sending limit exceeded », « quota exceeded »,
 * « credits exhausted »), et l'API de Brevo répond HTTP 402 ou 429.
 */
export function estErreurDeQuota(erreur: unknown): boolean {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  const reponse =
    erreur && typeof erreur === 'object' && 'response' in erreur
      ? String(erreur.response)
      : '';

  return /quota|limit|exceed|too many|credit|throttl|daily|\brate\b|HTTP (402|429)/i.test(
    `${message} ${reponse}`,
  );
}

/** Une voie SMTP : un `Transporter` nodemailer, avec au besoin un autre expéditeur. */
export function voieSmtp(
  nom: string,
  transporteur: {
    sendMail(donnees: Record<string, unknown>): Promise<Remise>;
  },
  expediteur?: string,
): Voie {
  return {
    nom,
    // Un relais d'un autre fournisseur n'accepte d'ordinaire que les adresses
    // de son propre domaine : un expéditeur propre à la voie évite le refus
    // (ou, pire, un message classé en pourriel faute d'alignement SPF/DKIM).
    envoyer: (donnees) =>
      transporteur.sendMail(
        expediteur ? { ...donnees, from: expediteur } : donnees,
      ),
  };
}

/** Une voie qui est un greffon de transport nodemailer (l'API de Brevo). */
export function voieGreffon(
  nom: string,
  greffon: { send(mail: MessageNodemailer, callback: Rappel): void },
): Voie {
  return {
    nom,
    envoyer: (donnees) =>
      new Promise((resoudre, rejeter) => {
        greffon.send({ data: donnees }, (erreur, info) =>
          erreur ? rejeter(erreur) : resoudre({ messageId: info?.messageId }),
        );
      }),
  };
}

export function transportEnCascade(options: {
  voies: Voie[];
  /** Injectable pour les tests ; l'horloge réelle par défaut. */
  maintenant?: () => number;
}) {
  const logger = new Logger('TransportEnCascade');
  const maintenant = options.maintenant ?? Date.now;
  /** Voie → instant jusqu'auquel elle est laissée de côté. */
  const misesDeCote = new Map<Voie, number>();

  const disponibles = (): Voie[] => {
    const libres = options.voies.filter(
      (voie) => (misesDeCote.get(voie) ?? 0) <= maintenant(),
    );
    // Toutes en pause : on essaie quand même, plutôt que de ne rien envoyer.
    return libres.length > 0 ? libres : options.voies;
  };

  const essayer = async (mail: MessageNodemailer): Promise<Remise> => {
    const echecs: string[] = [];
    const voies = disponibles();

    for (const voie of voies) {
      try {
        const remise = await voie.envoyer(mail.data);
        if (voie !== options.voies[0]) {
          logger.log(`Message remis par la voie de secours : ${voie.nom}.`);
        }
        return remise;
      } catch (erreur: unknown) {
        const motif = erreur instanceof Error ? erreur.message : String(erreur);
        echecs.push(`${voie.nom} : ${motif}`);

        const quota = estErreurDeQuota(erreur);
        if (quota) {
          misesDeCote.set(voie, maintenant() + PAUSE_APRES_QUOTA_MS);
        }
        // Averti et non `error` : le message n'est pas perdu tant qu'il reste
        // une voie. C'est l'échec de la dernière qui mérite l'alerte, et
        // `MailService` la journalise déjà.
        logger.warn(
          `${voie.nom} n'a pas remis le message${
            quota
              ? ` (quota d'envoi probablement atteint ; voie laissée de côté ${
                  PAUSE_APRES_QUOTA_MS / 60_000
                } min)`
              : ''
          } : ${motif}`,
        );
      }
    }

    throw new Error(
      `Aucune voie d'envoi n'a remis le message — ${echecs.join(' | ')}`,
    );
  };

  return {
    name: 'en-cascade',
    version: '1.0.0',

    send(mail: MessageNodemailer, callback: Rappel): void {
      essayer(mail).then(
        (remise) => callback(null, { messageId: remise.messageId ?? '' }),
        (erreur: unknown) =>
          callback(
            erreur instanceof Error ? erreur : new Error(String(erreur)),
          ),
      );
    },
  };
}
