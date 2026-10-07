import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { FileModule } from '../file/file.module';
import { NotificationModule } from '../notification/notification.module';
import { Retrait } from '../paiement/entities/retrait.entity';
import { PaiementModule } from '../paiement/paiement.module';
import { SoldeModule } from '../solde/solde.module';
import { User } from '../user/entities/user.entity';
import { MouvementFonds } from './entities/mouvement-fonds.entity';
import { FondsController } from './fonds.controller';
import { FondsService } from './fonds.service';

/**
 * Suivi des fonds : le compte Fapshi d'un côté, les poches des membres de
 * l'autre.
 *
 * Cycle assumé avec les paiements : un dépôt se règle par la passerelle, et
 * l'aiguillage des paiements en applique l'issue ici.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MouvementFonds, Retrait, User]),
    forwardRef(() => PaiementModule),
    SoldeModule,
    NotificationModule,
    FileModule,
    BureauModule,
  ],
  controllers: [FondsController],
  providers: [FondsService],
  exports: [FondsService],
})
export class FondsModule {}
