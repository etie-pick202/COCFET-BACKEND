import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { GenerationModule } from '../generation/generation.module';
import { MailModule } from '../mail/mail.module';
import { User } from '../user/entities/user.entity';
import { CanalNotificationJournal } from './adaptateurs/canal-notification-journal';
import { AlerteTresorerieService } from './alerte-tresorerie.service';
import { Notification } from './entities/notification.entity';
import { PreferenceNotification } from './entities/preference-notification.entity';
import { Rappel } from './entities/rappel.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { CANAL_NOTIFICATION } from './ports/canal-notification';
import { RappelService } from './rappel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PreferenceNotification,
      Rappel,
      User,
    ]),
    GenerationModule,
    MailModule,
    // Pour savoir qui a la charge de la trésorerie. Aucun cycle : le bureau
    // ne dépend que du courrier et des préférences d'email.
    BureauModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    AlerteTresorerieService,
    RappelService,
    CanalNotificationJournal,
    { provide: CANAL_NOTIFICATION, useExisting: CanalNotificationJournal },
  ],
  // NotificationService est exporte : c'est le point d'entree unique par
  // lequel billetterie, boutique, sondages et articles notifieront. La classe
  // du double reste exportee pour que les tests lisent l'historique des envois.
  exports: [
    NotificationService,
    AlerteTresorerieService,
    CANAL_NOTIFICATION,
    CanalNotificationJournal,
  ],
})
export class NotificationModule {}
