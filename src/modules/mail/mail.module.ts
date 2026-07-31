import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';
import { MailService } from './mail.service';

/**
 * SMTP : Mailpit en développement (capture locale), Brevo en staging et en
 * production. Les deux se configurent via les mêmes variables MAIL_*.
 */
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const user = config.get<string>('MAIL_USER');
        const pass = config.get<string>('MAIL_PASSWORD');

        return {
          transport: {
            host: config.getOrThrow<string>('MAIL_HOST'),
            port: config.get<number>('MAIL_PORT', 587),
            secure: config.get<string>('MAIL_SECURE') === 'true',
            // Mailpit n'exige aucune authentification : on omet `auth` plutôt
            // que d'envoyer des identifiants vides, ce qui ferait échouer la
            // négociation SMTP.
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
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
