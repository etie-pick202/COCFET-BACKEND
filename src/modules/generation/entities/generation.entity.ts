import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/** Statistiques figées au moment de l'archivage d'une génération. */
export interface StatistiquesGeneration {
  totalEvents: number;
  totalRevenue: number;
  totalUsers: number;
  totalProducts: number;
}

/**
 * Une génération correspond au mandat d'un Bureau des Finissants.
 * L'archivage fige les statistiques et bascule sur une nouvelle génération.
 */
@Entity('generations')
export class Generation extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int' })
  annee: number;

  @Column()
  nom: string;

  @Column({ type: 'varchar', nullable: true })
  logo: string | null;

  @Column({ name: 'couleur_primaire', default: '#000000' })
  couleurPrimaire: string;

  @Column({ name: 'couleur_secondaire', default: '#FFFFFF' })
  couleurSecondaire: string;

  /** Une seule génération est active à la fois. */
  @Column({ name: 'is_active', default: false })
  isActive: boolean;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  stats: StatistiquesGeneration;
}
