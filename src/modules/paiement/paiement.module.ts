import { forwardRef, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BilletterieModule } from '../billetterie/billetterie.module';
import { PasserelleFapshi } from './adaptateurs/passerelle-fapshi';
import { PasserellePaiementFactice } from './adaptateurs/passerelle-paiement-factice';
import { Transaction } from './entities/transaction.entity';
import { PaiementController } from './paiement.controller';
import { PASSERELLE_PAIEMENT } from './ports/passerelle-paiement';
import { TransactionService } from './transaction.service';

const VARIABLES_FAPSHI = [
  'FAPSHI_API_USER',
  'FAPSHI_API_KEY',
  'FAPSHI_WEBHOOK_SECRET',
] as const;

/**
 * Choisit la passerelle selon la présence des identifiants Fapshi, comme le
 * stockage choisit entre R2 et le disque local. La bascule est automatique :
 * renseigner les trois variables suffit, aucun appelant ne change.
 *
 * Le bac à sable Fapshi se configure exactement comme la production, à l'URL
 * et aux identifiants près : un développeur qui les renseigne éprouve le vrai
 * adaptateur, pas le double.
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
        const configure = VARIABLES_FAPSHI.every((cle) =>
          Boolean(config.get<string>(cle)),
        );

        if (configure) {
          return new PasserelleFapshi(config);
        }

        if (config.get<string>('NODE_ENV') === 'production') {
          // En production, encaisser avec la passerelle factice reviendrait à
          // livrer des billets sans qu'aucun argent ne circule.
          throw new Error(
            'Les variables FAPSHI_* sont obligatoires en production : la passerelle factice ne debite personne.',
          );
        }

        new Logger('PaiementModule').warn(
          'Identifiants Fapshi absents : passerelle factice activee.',
        );
        return new PasserellePaiementFactice(config);
      },
    },
  ],
  exports: [PASSERELLE_PAIEMENT, TransactionService],
})
export class PaiementModule {}
