import { Logger } from '@nestjs/common';

/**
 * Transport nodemailer qui confie le message à un premier transport, puis à un
 * second si le premier échoue.
 *
 * Sert à envoyer par le **relais SMTP** de Brevo, seul capable d'incruster des
 * images dans le corps (logo du mandat, QR code du billet), tout en gardant
 * l'**API HTTP** en recours : un relais injoignable ou une clé SMTP révoquée
 * ne doit pas suffire à priver quelqu'un de son billet. Le message part alors
 * sans images incrustées, mais il part.
 */

interface MessageNodemailer {
  data: Record<string, unknown>;
}

type Rappel = (erreur: Error | null, info?: { messageId: string }) => void;

/** Ce que l'on attend du premier transport : un `Transporter` nodemailer. */
export interface EnvoyeurPrincipal {
  sendMail(donnees: Record<string, unknown>): Promise<{ messageId?: string }>;
}

/** Ce que l'on attend du second : un greffon de transport. */
export interface TransportGreffon {
  send(mail: MessageNodemailer, callback: Rappel): void;
}

export function transportAvecRepli(options: {
  principal: EnvoyeurPrincipal;
  repli: TransportGreffon;
  /** Nom lisible du premier transport, pour les journaux. */
  nomPrincipal?: string;
}) {
  const logger = new Logger('TransportAvecRepli');
  const nom = options.nomPrincipal ?? 'transport principal';

  return {
    name: 'avec-repli',
    version: '1.0.0',

    send(mail: MessageNodemailer, callback: Rappel): void {
      options.principal
        .sendMail(mail.data)
        .then((info) => callback(null, { messageId: info.messageId ?? '' }))
        .catch((erreur: unknown) => {
          // Averti et non `error` : le message n'est pas perdu, il emprunte
          // l'autre voie. C'est l'échec du recours qui mérite l'alerte, et
          // `MailService` la journalise déjà.
          logger.warn(
            `${nom} indisponible, envoi par l'API Brevo : ${
              erreur instanceof Error ? erreur.message : String(erreur)
            }`,
          );
          options.repli.send(mail, callback);
        });
    },
  };
}
