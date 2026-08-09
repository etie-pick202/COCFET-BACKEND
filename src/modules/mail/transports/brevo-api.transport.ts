import { Logger } from '@nestjs/common';

/**
 * Transport nodemailer parlant à l'**API HTTP** de Brevo plutôt qu'à son
 * relais SMTP.
 *
 * Railway filtre les ports SMTP sortants : depuis un conteneur, une connexion
 * vers `smtp-relay.brevo.com:587` n'aboutit jamais et expire au bout de deux
 * minutes. L'inscription répondait donc en 122 s — et sans mail, puisque
 * l'envoi avait échoué. L'API passe en HTTPS/443, que l'hébergeur ne bloque
 * pas.
 *
 * Il s'agit d'un transport nodemailer et non d'un client autonome : le rendu
 * Handlebars est fait en amont par le greffon « compile » de
 * `@nestjs-modules/mailer`, si bien que `MailService` et les neuf gabarits
 * restent inchangés.
 */

/** Au-delà, on abandonne : mieux vaut une erreur nette qu'une requête pendue. */
export const DELAI_MAX_MS = 10_000;

const URL_API_BREVO = 'https://api.brevo.com/v3/smtp/email';

interface Adresse {
  name?: string;
  address: string;
}

type AdresseBrute = string | Adresse | (string | Adresse)[];

interface PieceJointe {
  filename?: string;
  content?: Buffer | string;
}

interface DonneesMessage {
  from?: string | Adresse;
  to?: AdresseBrute;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: PieceJointe[];
}

interface MessageNodemailer {
  data: DonneesMessage;
}

interface DestinataireBrevo {
  email: string;
  name?: string;
}

/**
 * Extrait adresse et nom d'une forme quelconque acceptée par nodemailer :
 * « Nom <a@b.com> », « a@b.com », ou `{ name, address }`.
 */
function lireAdresse(valeur: string | Adresse): DestinataireBrevo | null {
  if (typeof valeur !== 'string') {
    return valeur.address
      ? { email: valeur.address, ...(valeur.name ? { name: valeur.name } : {}) }
      : null;
  }

  // Découpé à l'index plutôt qu'avec une expression régulière : « Nom <a@b> »
  // se prête à un motif dont le temps d'exécution explose sur une entrée
  // construite pour ça.
  const brut = valeur.trim();
  const ouvrant = brut.lastIndexOf('<');
  const fermant = brut.lastIndexOf('>');

  if (ouvrant !== -1 && fermant > ouvrant) {
    const email = brut.slice(ouvrant + 1, fermant).trim();
    const nom = brut.slice(0, ouvrant).trim().replace(/^"|"$/g, '');
    return email ? { email, ...(nom ? { name: nom } : {}) } : null;
  }

  return brut ? { email: brut } : null;
}

function lireAdresses(valeur: AdresseBrute | undefined): DestinataireBrevo[] {
  if (valeur === undefined) {
    return [];
  }

  const brutes = Array.isArray(valeur) ? valeur : [valeur];

  return brutes
    .flatMap((entree): (string | Adresse)[] =>
      // Une chaîne peut porter plusieurs adresses séparées par des virgules.
      typeof entree === 'string' ? entree.split(',') : [entree],
    )
    .map(lireAdresse)
    .filter((adresse): adresse is DestinataireBrevo => adresse !== null);
}

function lirePiecesJointes(
  pieces: PieceJointe[] | undefined,
): { name: string; content: string }[] {
  return (pieces ?? [])
    .filter((piece) => piece.content !== undefined)
    .map((piece, index) => ({
      name: piece.filename ?? `piece-jointe-${index + 1}`,
      content: Buffer.isBuffer(piece.content)
        ? piece.content.toString('base64')
        : Buffer.from(String(piece.content)).toString('base64'),
    }));
}

export interface OptionsTransportBrevo {
  cleApi: string;
  delaiMaxMs?: number;
  /** Injectable pour les tests ; `fetch` global de Node par défaut. */
  fetchImpl?: typeof fetch;
}

/**
 * Construit le transport. Le retour est volontairement typé `unknown` côté
 * appelant : `createTransport` de nodemailer accepte les greffons de transport,
 * mais ses types ne l'expriment pas simplement.
 */
export function transportBrevoApi(options: OptionsTransportBrevo) {
  const logger = new Logger('TransportBrevoApi');
  const delaiMaxMs = options.delaiMaxMs ?? DELAI_MAX_MS;
  const appeler = options.fetchImpl ?? fetch;

  return {
    name: 'brevo-api',
    version: '1.0.0',

    send(
      mail: MessageNodemailer,
      callback: (erreur: Error | null, info?: { messageId: string }) => void,
    ): void {
      const donnees = mail.data;
      const expediteur = donnees.from ? lireAdresse(donnees.from) : null;
      const destinataires = lireAdresses(donnees.to);

      if (!expediteur) {
        callback(
          new Error(
            'MAIL_FROM est absent ou illisible : Brevo exige un expéditeur.',
          ),
        );
        return;
      }
      if (destinataires.length === 0) {
        callback(new Error('Aucun destinataire lisible pour ce message.'));
        return;
      }

      const pieces = lirePiecesJointes(donnees.attachments);

      const corps = {
        sender: expediteur,
        to: destinataires,
        subject: donnees.subject ?? '',
        ...(donnees.html ? { htmlContent: donnees.html } : {}),
        ...(donnees.text ? { textContent: donnees.text } : {}),
        ...(pieces.length > 0 ? { attachment: pieces } : {}),
      };

      appeler(URL_API_BREVO, {
        method: 'POST',
        headers: {
          'api-key': options.cleApi,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(delaiMaxMs),
      })
        .then(async (reponse) => {
          if (!reponse.ok) {
            // Le corps porte le motif exact — expéditeur non validé, clé
            // invalide, quota dépassé. Sans lui, le diagnostic repartirait de
            // zéro, ce qui a déjà coûté cher ici.
            const detail = await reponse.text().catch(() => '');
            throw new Error(
              `Brevo a refusé l'envoi (HTTP ${reponse.status}) : ${detail}`,
            );
          }

          const charge = (await reponse.json().catch(() => ({}))) as {
            messageId?: string;
          };

          logger.log(
            `Message remis à Brevo pour ${destinataires.map((d) => d.email).join(', ')}.`,
          );
          callback(null, { messageId: charge.messageId ?? '' });
        })
        .catch((erreur: unknown) => {
          const cause =
            erreur instanceof Error && erreur.name === 'TimeoutError'
              ? new Error(
                  `Brevo n'a pas répondu en moins de ${delaiMaxMs} ms : envoi abandonné.`,
                )
              : erreur;
          callback(cause instanceof Error ? cause : new Error(String(cause)));
        });
    },
  };
}
