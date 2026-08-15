import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BilletterieService } from './billetterie.service';

/**
 * Efface chaque nuit le nom du portier au-delà d'une semaine.
 *
 * **Le passage survit à son contrôleur.** Ce qui compte à long terme est que
 * la personne est entrée — `scannedAt` le dit, et le comptage des entrées en
 * dépend. Le nom de qui l'a laissée entrer sert à vérifier un contrôle récent,
 * une contestation à l'entrée, un billet passé deux fois ; passé la semaine,
 * plus personne ne le consulte, et le garder ferait de la billetterie un
 * fichier de présence du bureau que personne n'a demandé.
 *
 * Séparé du service métier pour que celui-ci reste appelable à la main — dans
 * un test, ou depuis une commande d'administration — sans embarquer de
 * planification.
 */
@Injectable()
export class PurgeTracesScanService {
  private readonly logger = new Logger(PurgeTracesScanService.name);

  constructor(private readonly billetterie: BilletterieService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purger(): Promise<void> {
    try {
      const effacees = await this.billetterie.purgerTracesScan();

      if (effacees > 0) {
        this.logger.log(
          `Purge des traces de contrôle : ${effacees} effacée(s).`,
        );
      }
    } catch (erreur) {
      // Une purge ratée se rejouera demain. La laisser remonter ferait tomber
      // la tâche planifiée, et plus rien ne serait purgé ensuite.
      this.logger.error(
        `Purge des traces de contrôle impossible : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }
}
