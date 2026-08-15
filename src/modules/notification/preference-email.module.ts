import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferenceNotification } from './entities/preference-notification.entity';
import { PreferenceEmailService } from './preference-email.service';

/**
 * Module minimal, exprès.
 *
 * `NotificationModule` importe le courrier, qui importe les générations, qui
 * importent le bureau. Faire dépendre le bureau des notifications fermerait
 * donc une boucle, et Nest refuserait de démarrer.
 *
 * Celui-ci ne connaît que le dépôt des réglages : tout module peut l'importer
 * sans rien entraîner derrière lui.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PreferenceNotification])],
  providers: [PreferenceEmailService],
  exports: [PreferenceEmailService],
})
export class PreferenceEmailModule {}
