import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { GenerationModule } from '../generation/generation.module';
import { User } from '../user/entities/user.entity';
import { CotisationController } from './cotisation.controller';
import { CotisationService } from './cotisation.service';
import { Cotisation } from './entities/cotisation.entity';
import { ParticipationCotisation } from './entities/participation-cotisation.entity';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { VersementFinance } from './entities/versement-finance.entity';

/**
 * Les cotisations vivent à part des événements.
 *
 * On n'assiste pas à une cotisation, on n'y prend pas de place et il n'y a pas
 * de billet : ce qui la caractérise est un montant dû par personne, suivi
 * jusqu'à son solde. Étendre la billetterie l'aurait chargée de règles de
 * paiement fractionné qui ne la concernent pas.
 *
 * `BureauModule` fournit le garde des privilèges : lancer une cotisation et
 * lire la situation financière de chacun exigent l'accès aux finances.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cotisation,
      TrancheCotisation,
      ParticipationCotisation,
      VersementFinance,
      User,
    ]),
    BureauModule,
    GenerationModule,
  ],
  controllers: [CotisationController],
  providers: [CotisationService],
  // Exporté pour l'aiguillage des paiements : un règlement en ligne comme la
  // validation d'une preuve remise en main propre viennent créditer un solde.
  exports: [CotisationService],
})
export class CotisationModule {}
