import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Etudiant } from '../../etudiant/entities/etudiant.entity';

@Entity('experiences')
export class Experience extends BaseEntity {
  @Column()
  poste: string;

  @Column()
  entreprise: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'date_debut', type: 'date' })
  dateDebut: Date;

  /** Nul si le poste est toujours occupé. */
  @Column({ name: 'date_fin', type: 'date', nullable: true })
  dateFin: Date | null;

  @ManyToOne(() => Etudiant, (etudiant) => etudiant.experiences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'etudiant_id' })
  etudiant: Etudiant;
}
