import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { CanalRappel, Rappel } from './entities/rappel.entity';
import { TypeNotification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

/**
 * Envoi des rappels programmés avant un événement.
 *
 * La granularité est la minute : un rappel réglé à 18 h 00 part entre 18 h 00
 * et 18 h 01. Rien ne justifie plus de précision pour un rappel d'événement,
 * et une tâche à la seconde interrogerait la base 60 fois plus souvent.
 */
@Injectable()
export class RappelService {
  private readonly logger = new Logger(RappelService.name);

  /**
   * Plafond par passage. Sans lui, un redémarrage après une longue coupure
   * tenterait d'envoyer d'un coup tous les rappels accumulés, et bloquerait le
   * processus le temps de les traiter.
   */
  private static readonly PAR_PASSAGE = 200;

  constructor(
    @InjectRepository(Rappel) private readonly rappels: Repository<Rappel>,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async envoyerLesRappelsDus(maintenant = new Date()): Promise<number> {
    const dus = await this.rappels.find({
      where: { isSent: false, dateRappel: LessThanOrEqual(maintenant) },
      relations: { user: true, evenement: true },
      order: { dateRappel: 'ASC' },
      take: RappelService.PAR_PASSAGE,
    });

    if (dus.length === 0) {
      return 0;
    }

    // Marqués comme envoyés **avant** l'envoi, et en une seule requête : si le
    // processus meurt au milieu, le pire est un rappel manqué. L'ordre inverse
    // ferait qu'un redémarrage renverrait à tout le monde ce qui est déjà
    // parti — un rappel en double est plus gênant qu'un rappel perdu, et deux
    // instances traiteraient la même liste.
    await this.rappels.update(
      { id: In(dus.map((r) => r.id)) },
      { isSent: true },
    );

    for (const rappel of dus) {
      await this.notificationService.notifier({
        destinataire: rappel.user,
        type: TypeNotification.RAPPEL,
        titre: `Rappel : ${rappel.evenement.titre}`,
        message: this.corps(rappel),
        lien: `/evenements/${rappel.evenement.id}`,
      });
    }

    this.logger.log(`${dus.length} rappel(s) envoyé(s).`);
    return dus.length;
  }

  private corps(rappel: Rappel): string {
    const canaux = rappel.canaux?.length ? rappel.canaux : [CanalRappel.PUSH];

    return (
      `L'événement « ${rappel.evenement.titre} » approche. ` +
      `Rappel demandé via ${canaux.join(' et ').toLowerCase()}.`
    );
  }
}
