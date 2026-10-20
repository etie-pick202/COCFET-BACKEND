import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvenementModule } from '../evenement/evenement.module';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notification/notification.module';
import { PaiementModule } from '../paiement/paiement.module';
import { UserModule } from '../user/user.module';
import { BilletterieController } from './billetterie.controller';
import { BilletterieService } from './billetterie.service';
import { OptionsEvenementController } from './options-evenement.controller';
import { OptionsEvenementService } from './options-evenement.service';
import { Evenement } from '../evenement/entities/evenement.entity';
import { Inscription } from './entities/inscription.entity';
import { AffectationScanner } from './entities/affectation-scanner.entity';
import { PurgeTracesScanService } from './purge-traces-scan.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inscription, AffectationScanner, Evenement]),
    EvenementModule,
    MailModule,
    NotificationModule,
    forwardRef(() => PaiementModule),
    UserModule,
  ],
  controllers: [BilletterieController, OptionsEvenementController],
  providers: [
    BilletterieService,
    OptionsEvenementService,
    PurgeTracesScanService,
  ],
  exports: [BilletterieService],
})
export class BilletterieModule {}
