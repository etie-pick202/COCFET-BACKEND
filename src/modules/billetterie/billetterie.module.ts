import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvenementModule } from '../evenement/evenement.module';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notification/notification.module';
import { PaiementModule } from '../paiement/paiement.module';
import { UserModule } from '../user/user.module';
import { BilletterieController } from './billetterie.controller';
import { BilletterieService } from './billetterie.service';
import { Inscription } from './entities/inscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inscription]),
    EvenementModule,
    MailModule,
    NotificationModule,
    forwardRef(() => PaiementModule),
    UserModule,
  ],
  controllers: [BilletterieController],
  providers: [BilletterieService],
  exports: [BilletterieService],
})
export class BilletterieModule {}
