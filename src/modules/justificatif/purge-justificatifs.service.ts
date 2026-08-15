import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JustificatifService } from './justificatif.service';

/**
 * Efface chaque nuit les captures de plus de deux mois.
 *
 * **La décision survit à l'image.** Ce qui compte à long terme est qu'un
 * paiement a été reconnu, par qui et quand — la ligne le dit et reste. La
 * capture, elle, est un relevé bancaire qui ne nous appartient pas et dont
 * l'usage a cessé : la garder indéfiniment serait conserver la pièce d'autrui
 * sans raison.
 *
 * Séparé du service métier pour que celui-ci reste appelable à la main — dans
 * un test, ou depuis une commande d'administration — sans embarquer de
 * planification.
 */
@Injectable()
export class PurgeJustificatifsService {
  private readonly logger = new Logger(PurgeJustificatifsService.name);

  constructor(private readonly justificatifs: JustificatifService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purger(): Promise<void> {
    try {
      const effacees = await this.justificatifs.purger();

      if (effacees > 0) {
        this.logger.log(
          `Purge des preuves de paiement : ${effacees} effacée(s).`,
        );
      }
    } catch (erreur) {
      // Une purge ratée se rejouera demain. La laisser remonter ferait tomber
      // la tâche planifiée, et plus rien ne serait purgé ensuite.
      this.logger.error(
        `Purge des preuves de paiement impossible : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }
}
