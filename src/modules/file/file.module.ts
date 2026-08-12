import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NettoyageFichiers } from './nettoyage-fichiers.service';
import { StockageLocal } from './adaptateurs/stockage-local';
import { StockageR2 } from './adaptateurs/stockage-r2';
import { FileController } from './file.controller';
import { STOCKAGE } from './ports/stockage';

const VARIABLES_R2 = [
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

/**
 * Choisit l'adaptateur selon la présence des identifiants R2.
 *
 * Sans ce choix, l'application refuserait de démarrer chez quiconque n'a pas
 * de compte Cloudflare — c'est-à-dire toute l'équipe aujourd'hui. La bascule
 * est automatique : renseigner les variables R2_* suffit à passer au stockage
 * distant.
 */
@Module({
  controllers: [FileController],
  providers: [
    NettoyageFichiers,
    {
      provide: STOCKAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configureR2 = VARIABLES_R2.every((cle) =>
          Boolean(config.get<string>(cle)),
        );

        if (configureR2) {
          return new StockageR2(config);
        }

        if (config.get<string>('NODE_ENV') === 'production') {
          // En production, retomber sur le disque perdrait les fichiers au
          // premier redéploiement : mieux vaut refuser de démarrer.
          throw new Error(
            'Les variables R2_* sont obligatoires en production : le stockage local ne survit pas à un redéploiement.',
          );
        }

        new Logger('FileModule').warn(
          'Identifiants R2 absents : stockage local activé.',
        );
        return new StockageLocal(config);
      },
    },
  ],
  exports: [STOCKAGE, NettoyageFichiers],
})
export class FileModule {}
