import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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
import { BoutiqueModule } from './modules/boutique/boutique.module';
import { CommandeModule } from './modules/commande/commande.module';
import { EvenementModule } from './modules/evenement/evenement.module';
import { FileModule } from './modules/file/file.module';
import { GenerationModule } from './modules/generation/generation.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PaiementModule } from './modules/paiement/paiement.module';
import { SondageModule } from './modules/sondage/sondage.module';
import { SponsorModule } from './modules/sponsor/sponsor.module';
import { UserModule } from './modules/user/user.module';

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
    // Socle
    AuthModule,
    UserModule,
    GenerationModule,
    // M1 — Événements & billetterie
    EvenementModule,
    BilletterieModule,
    // M2 — Boutique & commandes
    BoutiqueModule,
    CommandeModule,
    PaiementModule,
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
