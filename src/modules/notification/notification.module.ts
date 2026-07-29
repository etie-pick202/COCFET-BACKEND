import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { Rappel } from './entities/rappel.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, Rappel])],
})
export class NotificationModule {}
