import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanalNotificationJournal } from './adaptateurs/canal-notification-journal';
import { Notification } from './entities/notification.entity';
import { Rappel } from './entities/rappel.entity';
import { CANAL_NOTIFICATION } from './ports/canal-notification';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, Rappel])],
  providers: [
    CanalNotificationJournal,
    { provide: CANAL_NOTIFICATION, useExisting: CanalNotificationJournal },
  ],
  // La classe est exportée en plus du jeton pour que les tests puissent lire
  // l'historique des envois ; le code métier, lui, n'injecte que le jeton.
  exports: [CANAL_NOTIFICATION, CanalNotificationJournal],
})
export class NotificationModule {}
