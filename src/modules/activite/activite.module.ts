import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActiviteService } from './activite.service';
import { JournalActivite } from './entities/journal-activite.entity';

/**
 * Global à dessein.
 *
 * Presque tous les modules ont un fait à consigner — inscription, paiement,
 * scan, commande, passation. Les faire tous importer `ActiviteModule`
 * ajouterait une ligne d'import partout pour une dépendance qui n'exprime
 * aucun couplage métier : le journal ne décide de rien, il enregistre.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([JournalActivite])],
  providers: [ActiviteService],
  exports: [ActiviteService],
})
export class ActiviteModule {}
