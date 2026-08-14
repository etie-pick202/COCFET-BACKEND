import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import databaseConfig from './config/database.config';
import { validateEnv } from './config/env.validation';
import { ActiviteModule } from './modules/activite/activite.module';
import { AnnuaireModule } from './modules/annuaire/annuaire.module';
import { ArticleModule } from './modules/article/article.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { BilletterieModule } from './modules/billetterie/billetterie.module';
import { BureauModule } from './modules/bureau/bureau.module';
import { TableauDeBordModule } from './modules/tableau-de-bord/tableau-de-bord.module';
import { BoutiqueModule } from './modules/boutique/boutique.module';
import { CommandeModule } from './modules/commande/commande.module';
import { EvenementModule } from './modules/evenement/evenement.module';
import { DocumentModule } from './modules/document/document.module';
import { FileModule } from './modules/file/file.module';
import { GenerationModule } from './modules/generation/generation.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PaiementModule } from './modules/paiement/paiement.module';
import { SondageModule } from './modules/sondage/sondage.module';
import { SponsorModule } from './modules/sponsor/sponsor.module';
import { UserModule } from './modules/user/user.module';
import { JustificatifModule } from './modules/justificatif/justificatif.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    // Taches planifiees : purge des comptes non verifies, purge des
    // notifications anciennes, envoi des rappels d'evenement.
    //
    // Desactivees quand TACHES_PLANIFIEES=false, ce que font les tests
    // end-to-end. La tache de rappel s'execute a la minute : sur une suite qui
    // dure plusieurs minutes, elle se declenchait au milieu des tests, ecrivait
    // des notifications et rendait les comptages non deterministes. Les
    // services restent appelables directement, et c'est ainsi qu'ils sont
    // eprouves.
    ...(process.env.TACHES_PLANIFIEES === 'false'
      ? []
      : [ScheduleModule.forRoot()]),
    // Socle
    AuthModule,
    UserModule,
    GenerationModule,
    BureauModule,
    TableauDeBordModule,
    // M1 — Événements & billetterie
    EvenementModule,
    BilletterieModule,
    // M2 — Boutique & commandes
    BoutiqueModule,
    CommandeModule,
    PaiementModule,
    JustificatifModule,
    // M3 — Annuaire des finissants
    AnnuaireModule,
    // M4 — Sponsors
    SponsorModule,
    // M5 — Actualités
    ArticleModule,
    // M6 — Sondages
    SondageModule,
    // M7 — Notifications
    NotificationModule,
    // Transverse
    ActiviteModule,
    MailModule,
    FileModule,
    DocumentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Authentification exigée par défaut : les routes ouvertes sont marquées @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
