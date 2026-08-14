import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { OrigineTransaction } from '../../paiement/entities/transaction.entity';
import { User } from '../../user/entities/user.entity';

export enum StatutJustificatif {
  EN_ATTENTE = 'EN_ATTENTE',
  VALIDE = 'VALIDE',
  REFUSE = 'REFUSE',
}

/**
 * Preuve de paiement remise hors de la plateforme.
 *
 * Tout le monde ne paie pas en ligne : on règle parfois le trésorier de la
 * main à la main, ou par un transfert dont la plateforme ne voit rien. Sans ce
 * chemin, ces règlements n'existent nulle part — la place reste en attente, et
 * le journal de trésorerie ignore un argent pourtant encaissé.
 *
 * **La pièce ne vaut rien par elle-même.** Une capture d'écran se fabrique en
 * deux minutes ; c'est la validation par quelqu'un qui accède aux finances qui
 * transforme cette image en paiement reconnu. La pièce sert à justifier une
 * décision humaine, pas à la remplacer.
 *
 * Le justificatif ne connaît ni commande ni inscription : il porte une
 * **référence de transaction** et son origine, exactement comme la
 * notification d'un prestataire. C'est ce qui lui permet de servir demain aux
 * cotisations sans qu'une ligne ne change ici.
 */
@Entity('justificatifs_paiement')
export class JustificatifPaiement extends BaseEntity {
  /**
   * Référence de la transaction justifiée.
   *
   * Indexée : la trésorerie consulte les pièces d'un règlement précis, et le
   * contrôle d'unicité d'une pièce en attente s'appuie dessus.
   */
  @Index()
  @Column()
  @ApiProperty({ description: 'Référence de la transaction justifiée.' })
  reference: string;

  @Column({ type: 'enum', enum: OrigineTransaction })
  @ApiProperty({ enum: OrigineTransaction })
  origine: OrigineTransaction;

  /** Clé de stockage de la capture. Vidée par la purge des deux mois. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({
    nullable: true,
    description:
      'Clé de la capture. Nulle une fois la pièce purgée : la décision, elle, ' +
      'est conservée.',
  })
  cle: string | null;

  /**
   * Montant déclaré par le payeur, en FCFA.
   *
   * Déclaratif et non contractuel : c'est ce que la personne affirme avoir
   * versé. La trésorerie le confronte à la capture, et c'est sa validation qui
   * fait foi — jamais ce nombre.
   */
  @Column({ name: 'montant_declare', type: 'int' })
  @ApiProperty({ description: 'Montant déclaré par le payeur, en FCFA.' })
  montantDeclare: number;

  @Column({
    type: 'enum',
    enum: StatutJustificatif,
    default: StatutJustificatif.EN_ATTENTE,
  })
  @Index()
  @ApiProperty({ enum: StatutJustificatif })
  statut: StatutJustificatif;

  /** Auteur du dépôt. L'historique doit dire à qui appartient chaque pièce. */
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ type: () => User })
  user: User;

  /**
   * Qui a tranché.
   *
   * `SET NULL` plutôt que `CASCADE` : le départ d'un membre du bureau ne doit
   * pas effacer les décisions qu'il a prises, sous peine de laisser des
   * paiements validés que plus personne n'assume.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'validateur_id' })
  @ApiProperty({ type: () => User, nullable: true })
  validateur: User | null;

  @Column({ name: 'decide_le', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  decideLe: Date | null;

  /** Renseigné sur un refus : la personne doit savoir quoi corriger. */
  @Column({ name: 'motif_refus', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  motifRefus: string | null;
}
