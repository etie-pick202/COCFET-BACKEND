import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { Evenement } from '../evenement/entities/evenement.entity';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notification/notification.module';
import { PaiementModule } from '../paiement/paiement.module';
import { DonBureauController, DonController } from './don.controller';
import { DonService } from './don.service';
import { Don } from './entities/don.entity';

/**
 * Les dons au comité.
 *
 * Cycle assumé avec les paiements : un don se règle par la passerelle, et
 * l'aiguillage des paiements en applique l'issue ici.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Don, Evenement]),
    forwardRef(() => PaiementModule),
    NotificationModule,
    MailModule,
    BureauModule,
  ],
  controllers: [DonController, DonBureauController],
  providers: [DonService],
  exports: [DonService],
})
export class DonModule {}
