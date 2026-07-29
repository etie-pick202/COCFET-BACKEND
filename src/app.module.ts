import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import databaseConfig from './config/database.config';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CompanyModule } from './modules/company/company.module';
import { EtudiantModule } from './modules/etudiant/etudiant.module';
import { ExperienceModule } from './modules/experience/experience.module';
import { FileModule } from './modules/file/file.module';
import { FormationModule } from './modules/formation/formation.module';
import { MailModule } from './modules/mail/mail.module';
import { OffreModule } from './modules/offre/offre.module';
import { PromotionModule } from './modules/promotion/promotion.module';
import { SkillsModule } from './modules/skills/skills.module';
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
    AuthModule,
    UserModule,
    EtudiantModule,
    CompanyModule,
    ExperienceModule,
    OffreModule,
    SkillsModule,
    FormationModule,
    PromotionModule,
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
