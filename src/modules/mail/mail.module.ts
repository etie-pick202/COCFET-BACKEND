import { MailerModule, MailerOptions } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { IdentiteVisuelleModule } from '../generation/identite-visuelle.module';
import { MailService } from './mail.service';
import { transportBrevoApi } from './transports/brevo-api.transport';
import { transportAvecRepli } from './transports/repli.transport';

/**
 * Trois configurations, choisies selon les variables présentes.
 *
 * **Relais SMTP et clé API** (`MAIL_HOST`, `MAIL_USER`, `MAIL_PASSWORD` et
 * `BREVO_API_KEY`) : le relais SMTP de Brevo d'abord, l'API HTTP en recours.
 * C'est le mode attendu sur le VPS. Seul le SMTP sait incruster une image dans
 * le corps d'un message — le logo du mandat, le QR code d'un billet — et l'API
 * prend le relais si le serveur SMTP ne répond pas.
 *
 * **Clé API seule** : l'API HTTP, sans images incrustées. C'était le mode de
 * l'hébergeur précédent, qui filtrait les ports SMTP sortants.
 *
 * **SMTP seul** : Mailpit en développement, qui capture les messages
 * localement sans compte ni clé.
 */
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cleApi = config.get<string>('BREVO_API_KEY');
        const hote = config.get<string>('MAIL_HOST');
        const user = config.get<string>('MAIL_USER');
        const pass = config.get<string>('MAIL_PASSWORD');
        const logger = new Logger('MailModule');

        const smtp = () => ({
          host: config.getOrThrow<string>('MAIL_HOST'),
          port: Number(config.get<string>('MAIL_PORT', '587')),
          secure: config.get<string>('MAIL_SECURE') === 'true',
          // Mailpit n'exige aucune authentification : on omet `auth` plutôt
          // que d'envoyer des identifiants vides, ce qui ferait échouer la
          // négociation SMTP.
          ...(user && pass ? { auth: { user, pass } } : {}),
          // Bornés : par défaut, nodemailer attend deux minutes une connexion
          // qui n'aboutit pas. Avec l'API en recours, mieux vaut abandonner
          // vite et passer par elle.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        });

        // `object` et non `MailerOptions['transport']` : nodemailer n'a pas de
        // types dans ce projet, et ce dernier se résout en type inconnu.
        let transport: object;

        if (cleApi && hote && user && pass) {
          transport = transportAvecRepli({
            // `secure: false` sur le port 587 n'est pas du texte en clair :
            // nodemailer y négocie STARTTLS, et Brevo l'exige.
            // eslint-disable-next-line sonarjs/no-clear-text-protocols
            principal: createTransport(smtp()),
            repli: transportBrevoApi({ cleApi }),
            nomPrincipal: `Relais SMTP ${hote}`,
          });
        } else if (cleApi) {
          if (config.get<string>('NODE_ENV') === 'production') {
            logger.warn(
              "Relais SMTP non configuré : envoi par l'API Brevo, sans logo " +
                'ni QR code dans le corps des messages.',
            );
          }
          transport = transportBrevoApi({
            cleApi,
          });
        } else {
          if (config.get<string>('NODE_ENV') === 'production') {
            // Averti et non bloquant : le reste de l'API doit continuer de
            // servir. Mais sans recours, une panne du relais prive tout le
            // monde de messages.
            logger.warn(
              'BREVO_API_KEY absente en production : aucun recours si le ' +
                'relais SMTP ne répond pas.',
            );
          }
          transport = smtp();
        }

        return {
          transport,
          // Valeurs par défaut de chaque message, pas options de transport. Le
          // typage de @nestjs-modules/mailer ne connaît que les secondes : les
          // types de nodemailer 10 séparent les deux, alors que les anciens les
          // confondaient. À l'exécution rien ne change, `from` reste appliqué.
          defaults: {
            from: config.get<string>(
              'MAIL_FROM',
              'COCFET <contact@cocfet-ucac-icam.com>',
            ),
          } as unknown as MailerOptions['defaults'],
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
          // `layout` enveloppe chaque gabarit dans « gabarit.hbs » : c'est ce
          // qui a permis de retirer des neuf fichiers le `<html>`, le `<body>`
          // et le pied de page qu'ils recopiaient tous. Le dossier
          // « partials » est balayé au premier envoi ; les partiels y
          // vivent à part, sinon les gabarits eux-mêmes en deviendraient.
          options: {
            layout: 'gabarit',
            partials: {
              dir: join(__dirname, 'templates', 'partials'),
              options: { strict: true },
            },
          },
        };
      },
    }),
    // Pour la charte du mandat, posée sur chaque message par le gabarit
    // commun. Le module de la charte ne dépend d'aucun module métier : rien ne
    // peut reboucler vers le courrier.
    IdentiteVisuelleModule,
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
