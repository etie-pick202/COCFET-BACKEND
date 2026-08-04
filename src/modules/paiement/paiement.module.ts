import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasserellePaiementFactice } from './adaptateurs/passerelle-paiement-factice';
import { Transaction } from './entities/transaction.entity';
import { PASSERELLE_PAIEMENT } from './ports/passerelle-paiement';

/**
 * Seule la passerelle factice est branchée pour l'instant : le compte NotchPay
 * n'est pas ouvert. Le jour où il le sera, l'adaptateur réel se substituera
 * ici et rien d'autre ne bougera — la billetterie et la boutique ne
 * connaissent que le port.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Transaction])],
  providers: [
    {
      provide: PASSERELLE_PAIEMENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PasserellePaiementFactice(config),
    },
  ],
  exports: [PASSERELLE_PAIEMENT],
})
export class PaiementModule {}
