import { Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { Sondage } from './sondage.entity';

/**
 * Trace **qu'une** personne a voté, sans dire **ce qu'elle** a voté.
 *
 * C'est ce qui rend le vote anonyme réellement anonyme tout en interdisant le
 * double vote. Le bulletin — l'entité `Vote` — porte un `user` nul quand le
 * sondage est anonyme ; il ne reste alors aucun lien entre la personne et son
 * choix. La participation, elle, est toujours nominative, et son index unique
 * fait échouer la seconde tentative en base plutôt qu'en mémoire.
 *
 * Deux tables plutôt qu'une colonne : garder le `user` sur le bulletin et se
 * contenter de ne pas l'exposer laisserait le lien en base, lisible par
 * quiconque accède à la réplique ou à une sauvegarde. Un sondage sur la
 * qualité du mandat cesserait d'être sincère.
 *
 * Il n'y a **aucune relation** entre une participation et un bulletin : les
 * rapprocher par leur horodatage reste possible sur un sondage à trois votants,
 * l'anonymat d'un petit échantillon n'étant jamais absolu. Sur une promotion
 * entière, il ne l'est plus.
 */
@Entity('participations_sondage')
// Index et contraintes nommés explicitement, du même nom que dans la migration.
// Laissés à TypeORM, ils porteraient un condensé calculé, et le contrôle de
// dérive de l'intégration continue verrait un écart à chaque exécution.
@Index('uq_participation_sondage_user', ['sondage', 'user'], { unique: true })
export class ParticipationSondage extends BaseEntity {
  // `nullable: false` : une participation sans sondage ni votant ne veut rien
  // dire, et une colonne nulle échapperait à l'index unique — c'est exactement
  // le défaut que cette table corrige.
  @ManyToOne(() => Sondage, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'sondage_id',
    foreignKeyConstraintName: 'FK_participation_sondage',
  })
  sondage: Sondage;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_participation_user',
  })
  user: User;
}
