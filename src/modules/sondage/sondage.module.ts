import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';
import { OptionSondage } from './entities/option-sondage.entity';
import { ParticipationSondage } from './entities/participation-sondage.entity';
import { Sondage } from './entities/sondage.entity';
import { Vote } from './entities/vote.entity';
import { SondageController } from './sondage.controller';
import { SondageService } from './sondage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Sondage,
      OptionSondage,
      Vote,
      ParticipationSondage,
    ]),
    NotificationModule,
    // Pour recharger le votant : l'éligibilité au vote dépend de sa promotion,
    // que le jeton ne porte pas.
    UserModule,
  ],
  controllers: [SondageController],
  providers: [SondageService],
  exports: [SondageService],
})
export class SondageModule {}
