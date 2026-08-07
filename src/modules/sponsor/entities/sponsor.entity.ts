import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToMany,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { User } from '../../user/entities/user.entity';
import { PalierSponsor } from './palier-sponsor.entity';

/** Quotas dérogatoires, prioritaires sur ceux du palier lorsqu'ils sont définis. */
export interface QuotasPersonnalises {
  consultationsProfils?: number;
  telechargementsCv?: number;
}

/** Compteurs d'usage, remis à zéro à chaque période de facturation. */
export interface StatistiquesSponsor {
  vuesPage: number;
  profilsConsultes: number;
  cvTelecharges: number;
}

@Entity('sponsors')
export class Sponsor extends BaseEntity {
  /** Compte de connexion associé au sponsor. */
  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ nullable: true, required: false })
  user: User | null;

  @Column()
  @ApiProperty()
  nom: string;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  logo: string | null;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  description: string | null;

  @Column({ name: 'site_web', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  siteWeb: string | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  secteur: string | null;

  @Column()
  @ApiProperty()
  email: string;

  @ManyToOne(() => PalierSponsor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'palier_id' })
  @ApiProperty({ nullable: true, required: false })
  palier: PalierSponsor | null;

  @Column({ name: 'quotas_personnalises', type: 'jsonb', nullable: true })
  @ApiProperty({ nullable: true })
  quotasPersonnalises: QuotasPersonnalises | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  @ApiProperty()
  stats: StatistiquesSponsor;

  @ManyToMany(() => Evenement, (evenement) => evenement.sponsors)
  @ApiProperty({ required: false })
  evenements: Evenement[];
}
