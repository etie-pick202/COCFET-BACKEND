import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { ReleveSolde } from '../paiement/entities/releve-solde.entity';
import { Retrait } from '../paiement/entities/retrait.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import { PaiementModule } from '../paiement/paiement.module';
import { SoldeController } from './solde.controller';
import { SoldeService } from './solde.service';

/**
 * Solde du compte Fapshi et retraits.
 *
 * Module à part, qui dépend du module de paiement et non l'inverse : la
 * passerelle y est seulement lue, et rien du côté de l'encaissement n'a à
 * connaître ce suivi. `BureauModule` fournit le garde de privilèges.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Retrait, ReleveSolde, Transaction]),
    PaiementModule,
    BureauModule,
  ],
  controllers: [SoldeController],
  providers: [SoldeService],
  exports: [SoldeService],
})
export class SoldeModule {}
