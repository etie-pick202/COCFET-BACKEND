import { forwardRef, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BilletterieModule } from '../billetterie/billetterie.module';
import { CommandeModule } from '../commande/commande.module';
import { PasserelleFapshi } from './adaptateurs/passerelle-fapshi';
import { PasserellePaiementFactice } from './adaptateurs/passerelle-paiement-factice';
import { Transaction } from './entities/transaction.entity';
import { PaiementController } from './paiement.controller';
import { ReconciliationService } from './reconciliation.service';
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
    forwardRef(() => CommandeModule),
  ],
  controllers: [PaiementController],
  providers: [
    TransactionService,
    ReconciliationService,
    {
      provide: PASSERELLE_PAIEMENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configure = VARIABLES_FAPSHI.every((cle) =>
          Boolean(config.get<string>(cle)),
        );

        if (configure) {
          // `FAPSHI_BASE_URL` est facultative et retombe sur le bac a sable.
          // Ce silence a deja coute une panne : des cles de production
          // envoyees au sandbox, refusees en 403, et aucun paiement possible
          // pendant que le journal ne disait rien au demarrage.
          const url = config.get<string>('FAPSHI_BASE_URL');
          if (
            config.get<string>('NODE_ENV') === 'production' &&
            (!url || url.includes('sandbox'))
          ) {
            new Logger('PaiementModule').warn(
              `FAPSHI_BASE_URL vaut « ${url ?? 'non definie, donc le bac a sable'} » en production. ` +
                'Avec des cles de production, le sandbox repond 403 et aucun paiement ne passe. ' +
                'Avec des cles de bac a sable, les commandes sont validees sans qu aucun argent ne circule. ' +
                'La valeur attendue est https://live.fapshi.com.',
            );
          }

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
