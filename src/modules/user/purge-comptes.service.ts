import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { User } from './entities/user.entity';

/**
 * Suppression des comptes restés non vérifiés.
 *
 * S'inscrire n'exige rien d'autre qu'une adresse : sans purge, n'importe qui
 * peut faire grossir `users` indéfiniment, et chaque ligne créée déclenche un
 * envoi imputé au quota Brevo. Une adresse jamais confirmée n'appartient de
 * toute façon à personne — la conserver ne protège aucun utilisateur réel, et
 * la libérer permet au véritable titulaire de s'inscrire à son tour.
 *
 * Les comptes vérifiés ne sont jamais touchés, quel que soit leur rôle : un
 * visiteur externe est un utilisateur légitime de la plateforme.
 */
@Injectable()
export class PurgeComptesService {
  private readonly logger = new Logger(PurgeComptesService.name);
  private readonly delaiJours: number;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    config: ConfigService,
  ) {
    this.delaiJours = Number(
      config.get<string>('PURGE_COMPTES_NON_VERIFIES_JOURS', '7'),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeQuotidienne(): Promise<void> {
    const supprimes = await this.purger();
    if (supprimes > 0) {
      this.logger.log(`${supprimes} compte(s) non vérifié(s) supprimé(s).`);
    }
  }

  /**
   * Renvoie le nombre de comptes supprimés. Séparé de la tâche planifiée pour
   * rester appelable à la main et testable sans attendre 4 h du matin.
   */
  async purger(maintenant = new Date()): Promise<number> {
    const limite = new Date(
      maintenant.getTime() - this.delaiJours * 24 * 60 * 60 * 1000,
    );

    const resultat = await this.users.delete({
      emailVerifieLe: IsNull(),
      createdAt: LessThan(limite),
      // Un sponsor est créé par l'administration et n'a pas encore cliqué son
      // invitation : le supprimer effacerait un partenariat négocié hors de la
      // plateforme, que personne ne pourrait deviner qu'il a existé.
      role: Not(Role.SPONSOR),
    });

    return resultat.affected ?? 0;
  }
}
