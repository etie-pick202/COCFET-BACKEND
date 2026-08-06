import { forwardRef, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BilletterieModule } from '../billetterie/billetterie.module';
import { PasserelleNotchPay } from './adaptateurs/passerelle-notchpay';
import { PasserellePaiementFactice } from './adaptateurs/passerelle-paiement-factice';
import { Transaction } from './entities/transaction.entity';
import { PaiementController } from './paiement.controller';
import { PASSERELLE_PAIEMENT } from './ports/passerelle-paiement';
import { TransactionService } from './transaction.service';

const VARIABLES_NOTCHPAY = [
  'NOTCHPAY_PUBLIC_KEY',
  'NOTCHPAY_SECRET_KEY',
  'NOTCHPAY_WEBHOOK_SECRET',
] as const;

/**
 * Choisit la passerelle selon la présence des identifiants NotchPay, comme le
 * stockage choisit entre R2 et le disque local. La bascule est automatique :
 * renseigner les trois variables suffit, aucun appelant ne change.
 *
 * BilletterieModule est importé en `forwardRef` : la billetterie a besoin de
 * la passerelle pour encaisser, et le webhook a besoin de la billetterie pour
 * confirmer le billet. La dépendance est circulaire par nature du domaine.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    forwardRef(() => BilletterieModule),
  ],
  controllers: [PaiementController],
  providers: [
    TransactionService,
    {
      provide: PASSERELLE_PAIEMENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configure = VARIABLES_NOTCHPAY.every((cle) =>
          Boolean(config.get<string>(cle)),
        );

        if (configure) {
          return new PasserelleNotchPay(config);
        }

        if (config.get<string>('NODE_ENV') === 'production') {
          // En production, encaisser avec la passerelle factice reviendrait à
          // livrer des billets sans qu'aucun argent ne circule.
          throw new Error(
            'Les variables NOTCHPAY_* sont obligatoires en production : la passerelle factice ne debite personne.',
          );
        }

        new Logger('PaiementModule').warn(
          'Identifiants NotchPay absents : passerelle factice activee.',
        );
        return new PasserellePaiementFactice(config);
      },
    },
  ],
  exports: [PASSERELLE_PAIEMENT, TransactionService],
})
export class PaiementModule {}
