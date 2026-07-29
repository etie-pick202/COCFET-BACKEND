import { Column, Entity, Index, ManyToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Etudiant } from '../../etudiant/entities/etudiant.entity';

@Entity('skills')
export class Skill extends BaseEntity {
  @Index({ unique: true })
  @Column()
  libelle: string;

  @Column({ type: 'varchar', nullable: true })
  categorie: string | null;

  @ManyToMany(() => Etudiant, (etudiant) => etudiant.skills)
  etudiants: Etudiant[];
}
