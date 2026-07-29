import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
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
}
