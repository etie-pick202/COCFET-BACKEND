import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { GenerationModule } from '../generation/generation.module';
import { MailService } from './mail.service';
import { transportBrevoApi } from './transports/brevo-api.transport';

/**
 * Deux transports, choisis par la configuration.
 *
 * `BREVO_API_KEY` présente : envoi par l'**API HTTP** de Brevo. C'est le mode
 * attendu en staging et en production, parce que Railway filtre les ports SMTP
 * sortants — une connexion vers `smtp-relay.brevo.com:587` depuis un conteneur
 * n'aboutit jamais et expire au bout de deux minutes. HTTPS/443 passe toujours.
 *
 * Sinon : SMTP, pour Mailpit en développement, qui capture les messages
 * localement sans compte ni clé.
 */
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cleApi = config.get<string>('BREVO_API_KEY');
        const user = config.get<string>('MAIL_USER');
        const pass = config.get<string>('MAIL_PASSWORD');

        if (!cleApi && config.get<string>('NODE_ENV') === 'production') {
          // Averti et non bloquant : le reste de l'API doit continuer de
          // servir. Mais sans cette clé, en production, aucun mail ne part —
          // et c'est précisément la panne qui s'était déguisée en lenteur.
          new Logger('MailModule').warn(
            'BREVO_API_KEY absente en production : envoi en SMTP, filtré par ' +
              'la plupart des hébergeurs. Les emails risquent de ne jamais partir.',
          );
        }

        return {
          transport: cleApi
            ? transportBrevoApi({ cleApi })
            : {
                host: config.getOrThrow<string>('MAIL_HOST'),
                port: config.get<number>('MAIL_PORT', 587),
                secure: config.get<string>('MAIL_SECURE') === 'true',
                // Mailpit n'exige aucune authentification : on omet `auth`
                // plutôt que d'envoyer des identifiants vides, ce qui ferait
                // échouer la négociation SMTP.
                ...(user && pass ? { auth: { user, pass } } : {}),
              },
          defaults: {
            from: config.get<string>(
              'MAIL_FROM',
              'COCFET <no-reply@cocfet.com>',
            ),
          },
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
    // commun. GenerationModule ne dépend pas du courrier : aucun cycle.
    GenerationModule,
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
