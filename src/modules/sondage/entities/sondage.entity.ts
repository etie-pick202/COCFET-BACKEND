import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { OptionSondage } from './option-sondage.entity';

export enum TypeSondage {
  CHOIX_UNIQUE = 'CHOIX_UNIQUE',
  CHOIX_MULTIPLE = 'CHOIX_MULTIPLE',
}

export enum StatutSondage {
  BROUILLON = 'BROUILLON',
  ACTIF = 'ACTIF',
  CLOS = 'CLOS',
}

/** Moment à partir duquel les résultats deviennent visibles des votants. */
export enum VisibiliteResultats {
  TOUJOURS = 'TOUJOURS',
  APRES_VOTE = 'APRES_VOTE',
  APRES_DEADLINE = 'APRES_DEADLINE',
}

@Entity('sondages')
export class Sondage extends BaseEntity {
  @Column()
  titre: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => OptionSondage, (option) => option.sondage, { cascade: true })
  options: OptionSondage[];

  @Column({
    type: 'enum',
    enum: TypeSondage,
    default: TypeSondage.CHOIX_UNIQUE,
  })
  type: TypeSondage;

  /** Si vrai, le vote n'est pas rattaché à son auteur. */
  @Column({ name: 'is_anonyme', default: false })
  isAnonyme: boolean;

  @Column({ type: 'timestamptz' })
  deadline: Date;

  @Column({
    name: 'visibilite_resultats',
    type: 'enum',
    enum: VisibiliteResultats,
    default: VisibiliteResultats.APRES_VOTE,
  })
  visibiliteResultats: VisibiliteResultats;

  @Column({
    type: 'enum',
    enum: StatutSondage,
    default: StatutSondage.BROUILLON,
  })
  statut: StatutSondage;

  /** Dénormalisé pour le calcul des pourcentages sans agrégation. */
  @Column({ name: 'total_votes', type: 'int', default: 0 })
  totalVotes: number;

  /** Réservé aux étudiants du campus lorsque vrai. */
  @Column({ name: 'campus_uniquement', default: true })
  campusUniquement: boolean;

  /**
   * Événement que le sondage accompagne : choix du thème d'un gala, du menu,
   * de la date d'une sortie.
   *
   * `SET NULL` plutôt que `CASCADE` : supprimer un événement ne doit pas
   * emporter la consultation qui l'a préparé. Les voix exprimées restent une
   * décision du bureau, même si l'événement n'a finalement pas eu lieu.
   */
  @ManyToOne(() => Evenement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'evenement_id' })
  evenement: Evenement | null;
}
