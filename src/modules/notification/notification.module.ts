import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationModule } from '../generation/generation.module';
import { MailModule } from '../mail/mail.module';
import { User } from '../user/entities/user.entity';
import { CanalNotificationJournal } from './adaptateurs/canal-notification-journal';
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
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    RappelService,
    CanalNotificationJournal,
    { provide: CANAL_NOTIFICATION, useExisting: CanalNotificationJournal },
  ],
  // NotificationService est exporte : c'est le point d'entree unique par
  // lequel billetterie, boutique, sondages et articles notifieront. La classe
  // du double reste exportee pour que les tests lisent l'historique des envois.
  exports: [NotificationService, CANAL_NOTIFICATION, CanalNotificationJournal],
})
export class NotificationModule {}
