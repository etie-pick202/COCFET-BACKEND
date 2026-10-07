import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

export enum TypeMouvementFonds {
  /** De l'argent reçu en main propre : il entre dans la poche de `membre`. */
  RECEPTION = 'RECEPTION',
  /** `membre` passe de l'argent à `contrepartie` : de poche à poche. */
  TRANSFERT = 'TRANSFERT',
  /** `membre` verse de sa poche sur le compte de la plateforme (Fapshi). */
  DEPOT_PLATEFORME = 'DEPOT_PLATEFORME',
  /** `membre` rend de l'argent à `beneficiaire`, hors plateforme. */
  REMBOURSEMENT = 'REMBOURSEMENT',
  /** `membre` dépense de sa poche pour le compte du bureau. */
  DEPENSE = 'DEPENSE',
}

export enum StatutMouvementFonds {
  /** Dépôt lancé, pas encore confirmé par Fapshi. */
  EN_ATTENTE = 'EN_ATTENTE',
  VALIDE = 'VALIDE',
  /** Dépôt non abouti : il ne compte nulle part. */
  ECHOUE = 'ECHOUE',
}

/**
 * Un déplacement d'argent entre les « poches » des membres et le compte de la
 * plateforme.
 *
 * Le solde Fapshi dit ce qu'il y a **sur la plateforme**. Tout le reste de
 * l'argent du bureau est dans des mains — espèces et virements reçus par X,
 * retraits faits par Y. Ce registre est ce qui permet de répondre, à tout
 * moment, à « où est l'argent ? ».
 *
 * Chaque ligne porte le membre **qui l'a faite** (`membre`) : une remise se lit
 * toujours « remise de X ». Une ligne ne s'efface ni ne se modifie : une erreur
 * se corrige par un mouvement inverse, pour que l'historique reste lisible.
 */
@Entity('mouvements_fonds')
export class MouvementFonds extends BaseEntity {
  @Column({ type: 'enum', enum: TypeMouvementFonds })
  @ApiProperty({ enum: TypeMouvementFonds })
  type: TypeMouvementFonds;

  /**
   * Le membre dont la poche bouge : crédité pour une réception, débité pour
   * tout le reste. C'est lui qu'on lit comme l'auteur de la remise.
   */
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'membre_id' })
  @ApiProperty({ type: () => User })
  membre: User;

  /**
   * Qui a saisi la ligne, quand ce n'est pas `membre` : la trésorerie qui
   * déclare pour un autre. Une remise doit toujours dire qui l'a écrite.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'declare_par_id' })
  @ApiProperty({ type: () => User, nullable: true })
  declarePar: User | null;

  /** Pour un transfert : le membre dont la poche est créditée. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contrepartie_id' })
  @ApiProperty({ type: () => User, nullable: true })
  contrepartie: User | null;

  @Column({ type: 'int' })
  @ApiProperty({ description: 'Montant, en FCFA.' })
  montant: number;

  /** Remboursement : à qui l'argent est rendu. Dépense : chez qui. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  beneficiaire: string | null;

  /** Reçu d'où : le nom de qui a remis l'argent à `membre`. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  origine: string | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, description: 'Motif libre.' })
  note: string | null;

  /** Clé de stockage du justificatif joint. Vidée par la purge. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  piece: string | null;

  @Column({
    type: 'enum',
    enum: StatutMouvementFonds,
    default: StatutMouvementFonds.VALIDE,
  })
  @ApiProperty({ enum: StatutMouvementFonds })
  statut: StatutMouvementFonds;

  /**
   * Dépôt sur la plateforme : référence du paiement Fapshi (`REM-…`). C'est
   * par elle que l'issue du paiement retrouve le mouvement.
   */
  @Index({ unique: true, where: '"reference" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  /** Frais Fapshi retenus sur un dépôt : un coût pour le bureau. */
  @Column({ name: 'frais_prestataire', type: 'int', default: 0 })
  @ApiProperty({ description: 'Frais retenus par Fapshi, en FCFA.' })
  fraisPrestataire: number;

  /** Page de paiement Fapshi d'un dépôt encore en attente. */
  @Column({ name: 'url_paiement', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  urlPaiement: string | null;
}
