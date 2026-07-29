import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Company } from '../../company/entities/company.entity';

export enum TypeOffre {
  STAGE = 'STAGE',
  EMPLOI = 'EMPLOI',
  ALTERNANCE = 'ALTERNANCE',
}

export enum StatutOffre {
  BROUILLON = 'BROUILLON',
  PUBLIEE = 'PUBLIEE',
  CLOTUREE = 'CLOTUREE',
}

@Entity('offres')
export class Offre extends BaseEntity {
  @Column()
  titre: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: TypeOffre, default: TypeOffre.STAGE })
  type: TypeOffre;

  @Column({ type: 'enum', enum: StatutOffre, default: StatutOffre.BROUILLON })
  statut: StatutOffre;

  @Column({ type: 'varchar', nullable: true })
  localisation: string | null;

  @Column({ name: 'date_expiration', type: 'date', nullable: true })
  dateExpiration: Date | null;

  @ManyToOne(() => Company, (company) => company.offres, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
