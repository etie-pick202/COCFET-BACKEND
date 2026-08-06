import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';
import { GenerationModule } from '../generation/generation.module';
import { Evenement } from './entities/evenement.entity';
import { EvenementController } from './evenement.controller';
import { EvenementService } from './evenement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Evenement]),
    GenerationModule,
    NotificationModule,
    UserModule,
  ],
  controllers: [EvenementController],
  providers: [EvenementService],
  exports: [EvenementService],
})
export class EvenementModule {}
