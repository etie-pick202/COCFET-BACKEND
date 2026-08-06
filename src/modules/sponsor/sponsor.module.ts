import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UserModule } from '../user/user.module';
import { PalierSponsor } from './entities/palier-sponsor.entity';
import { Sponsor } from './entities/sponsor.entity';
import { SponsorController } from './sponsor.controller';
import { SponsorService } from './sponsor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sponsor, PalierSponsor]),
    // AuthModule expose JetonService : l'invitation partenaire réutilise le
    // même mécanisme de jeton à usage unique que la vérification d'adresse.
    AuthModule,
    UserModule,
    MailModule,
  ],
  controllers: [SponsorController],
  providers: [SponsorService],
  exports: [SponsorService],
})
export class SponsorModule {}
