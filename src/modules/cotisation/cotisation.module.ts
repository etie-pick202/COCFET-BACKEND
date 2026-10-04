import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { GenerationModule } from '../generation/generation.module';
import { NotificationModule } from '../notification/notification.module';
import { PaiementModule } from '../paiement/paiement.module';
import { User } from '../user/entities/user.entity';
import { CotisationController } from './cotisation.controller';
import { CotisationService } from './cotisation.service';
import { Cotisation } from './entities/cotisation.entity';
import { ParticipationCotisation } from './entities/participation-cotisation.entity';
import { ReglementCotisation } from './entities/reglement-cotisation.entity';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { VersementFinance } from './entities/versement-finance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cotisation,
      TrancheCotisation,
      ParticipationCotisation,
      ReglementCotisation,
      VersementFinance,
      User,
    ]),
    BureauModule,
    GenerationModule,
    NotificationModule,
    // Cycle assumé, comme pour la billetterie : une cotisation se paie par la
    // passerelle, et l'aiguillage des paiements crédite les cotisations.
    forwardRef(() => PaiementModule),
  ],
  controllers: [CotisationController],
  providers: [CotisationService],
  exports: [CotisationService],
})
export class CotisationModule {}
