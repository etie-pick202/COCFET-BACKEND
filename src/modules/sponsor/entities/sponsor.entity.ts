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
  user: User | null;

  @Column()
  nom: string;

  @Column({ type: 'varchar', nullable: true })
  logo: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'site_web', type: 'varchar', nullable: true })
  siteWeb: string | null;

  @Column({ type: 'varchar', nullable: true })
  secteur: string | null;

  @Column()
  email: string;

  @ManyToOne(() => PalierSponsor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'palier_id' })
  palier: PalierSponsor | null;

  @Column({ name: 'quotas_personnalises', type: 'jsonb', nullable: true })
  quotasPersonnalises: QuotasPersonnalises | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  stats: StatistiquesSponsor;

  @ManyToMany(() => Evenement, (evenement) => evenement.sponsors)
  evenements: Evenement[];
}
