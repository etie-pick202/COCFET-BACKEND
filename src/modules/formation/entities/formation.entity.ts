import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Etudiant } from '../../etudiant/entities/etudiant.entity';

@Entity('formations')
export class Formation extends BaseEntity {
  @Column()
  intitule: string;

  @Column()
  etablissement: string;

  @Column({ type: 'varchar', nullable: true })
  diplome: string | null;

  @Column({ name: 'annee_debut', type: 'int' })
  anneeDebut: number;

  @Column({ name: 'annee_fin', type: 'int', nullable: true })
  anneeFin: number | null;

  @ManyToOne(() => Etudiant, (etudiant) => etudiant.formations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'etudiant_id' })
  etudiant: Etudiant;
}
