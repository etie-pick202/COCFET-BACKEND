import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Etudiant } from '../../etudiant/entities/etudiant.entity';

/** Promotion d'une génération d'étudiants (ex. « 2027 »). */
@Entity('promotions')
export class Promotion extends BaseEntity {
  @Index({ unique: true })
  @Column()
  libelle: string;

  @Column({ name: 'annee_sortie', type: 'int' })
  anneeSortie: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => Etudiant, (etudiant) => etudiant.promotion)
  etudiants: Etudiant[];
}
