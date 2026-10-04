import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { StatutPaiement } from '../../paiement/enums/paiement.enum';
import { ParticipationCotisation } from './participation-cotisation.entity';

/** Comment le règlement est parvenu au bureau. */
export enum ModeReglement {
  /** Payé sur la plateforme, par Mobile Money. */
  EN_LIGNE = 'EN_LIGNE',
  /** Payé hors de la plateforme, prouvé par un justificatif. */
  JUSTIFICATIF = 'JUSTIFICATIF',
}

/**
 * Règlement d'une échéance de cotisation par une personne.
 *
 * Une échéance est soit une tranche de l'échéancier, soit **la totalité** du
 * reste dû — dont la date limite est la clôture de la cotisation. Le
 * règlement dit laquelle la personne a choisi de payer, et par quel moyen.
 *
 * C'est le pont entre une transaction et une participation. Avant lui, la
 * référence de transaction *était* l'identifiant de la participation : une
 * seule transaction possible par personne et par cotisation, et le
 * justificatif exigeait de demander cet identifiant au bureau. Désormais
 * chaque règlement porte sa propre référence, et un justificatif se rattache
 * à une échéance choisie dans la liste.
 *
 * **Le solde reste la vérité.** Un règlement abouti crédite `montantRegle` de
 * la participation ; l'échéancier se lit ensuite sur ce solde (voir
 * avancement.ts). Les échéances proposées au paiement sont, dans l'ordre, la
 * prochaine tranche non soldée et la totalité : payer une échéance la ferme
 * donc exactement.
 */
@Entity('reglements_cotisation')
export class ReglementCotisation extends BaseEntity {
  @ManyToOne(() => ParticipationCotisation, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'participation_id' })
  participation: ParticipationCotisation;

  /** Rang de la tranche réglée, ou nul pour la totalité du reste dû. */
  @Column({ name: 'ordre_tranche', type: 'int', nullable: true })
  @ApiProperty({
    nullable: true,
    description: 'Rang de la tranche réglée ; nul pour la totalité.',
  })
  ordreTranche: number | null;

  /** Libellé figé de l'échéance, tel que la personne l'a choisie. */
  @Column()
  @ApiProperty({ example: 'Première tranche' })
  libelle: string;

  /**
   * Montant porté au solde, en FCFA, frais exclus.
   *
   * Pour un justificatif, il devient à la validation le montant certifié par
   * la trésorerie : c'est ce qui a réellement été reçu.
   */
  @Column({ type: 'int' })
  @ApiProperty({ description: 'Montant crédité, frais exclus, en FCFA.' })
  montant: number;

  /** Ce que le payeur a été débité en ligne, frais compris. Nul hors ligne. */
  @Column({ name: 'montant_debite', type: 'int', nullable: true })
  @ApiProperty({ nullable: true })
  montantDebite: number | null;

  /** Référence de la transaction. Unique : c'est la clé d'idempotence. */
  @Index({ unique: true })
  @Column()
  @ApiProperty()
  reference: string;

  @Column({ type: 'enum', enum: ModeReglement })
  @ApiProperty({ enum: ModeReglement })
  mode: ModeReglement;

  @Index()
  @Column({
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutPaiement })
  statut: StatutPaiement;

  /**
   * Page de paiement du prestataire, quand la demande n'a pas pu être poussée
   * sur le téléphone. Effacée dès que le règlement est tranché.
   */
  @Column({ name: 'url_paiement', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  urlPaiement: string | null;
}
