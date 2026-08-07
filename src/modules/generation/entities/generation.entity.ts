import { ApiProperty } from '@nestjs/swagger';
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
/**
 * L'index partiel unique est declare ici **et** cree par migration : sans la
 * declaration, TypeORM le verrait comme un index de trop et proposerait de le
 * supprimer a la premiere generation de migration.
 */
@Index('uq_generation_active', ['isActive'], {
  unique: true,
  where: '"is_active" = true',
})
@Entity('generations')
export class Generation extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'int' })
  @ApiProperty()
  annee: number;

  /**
   * Nom du bureau — « ATLAS » pour la promotion 2027.
   *
   * Une génération **est** le mandat d'un bureau COCFET : c'est ce nom que la
   * plateforme affiche, pas un libellé de promotion.
   */
  @Column()
  @ApiProperty()
  nom: string;

  /**
   * Logo effectivement utilisé par l'application.
   *
   * Un bureau en fait souvent décliner plusieurs ; il faut donc désigner celui
   * qui habille la plateforme, sans quoi l'affichage dépendrait de l'ordre
   * d'envoi. Sa valeur appartient toujours à `logos`.
   */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  logo: string | null;

  /** Toutes les déclinaisons déposées, clés de stockage. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  @ApiProperty({ type: [String] })
  logos: string[];

  @Column({ name: 'couleur_primaire', default: '#000000' })
  @ApiProperty()
  couleurPrimaire: string;

  @Column({ name: 'couleur_secondaire', default: '#FFFFFF' })
  @ApiProperty()
  couleurSecondaire: string;

  /** Une seule génération est active à la fois. */
  @Column({ name: 'is_active', default: false })
  @ApiProperty()
  isActive: boolean;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  archivedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  @ApiProperty()
  stats: StatistiquesGeneration;
}
