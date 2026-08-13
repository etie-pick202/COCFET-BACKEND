import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from '../../paiement/enums/paiement.enum';
import { User } from '../../user/entities/user.entity';
import { LigneCommande } from './ligne-commande.entity';

export enum StatutCommande {
  EN_ATTENTE = 'EN_ATTENTE',
  PAYEE = 'PAYEE',
  /** Prête au retrait sur le campus. */
  PRETE = 'PRETE',
  RETIREE = 'RETIREE',
  ANNULEE = 'ANNULEE',
}

@Entity('commandes')
export class Commande extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ required: false })
  user: User;

  @OneToMany(() => LigneCommande, (ligne) => ligne.commande, { cascade: true })
  @ApiProperty({ type: () => [LigneCommande] })
  lignes: LigneCommande[];

  @Column({ type: 'int', default: 0 })
  @ApiProperty({
    description: 'FCFA. Calcule cote serveur, jamais recu du client.',
  })
  total: number;

  @Column({
    type: 'enum',
    enum: StatutCommande,
    default: StatutCommande.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutCommande })
  statut: StatutCommande;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  @ApiProperty({ enum: MethodePaiement, nullable: true })
  methodePaiement: MethodePaiement | null;

  @Column({
    name: 'statut_paiement',
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutPaiement })
  statutPaiement: StatutPaiement;

  @Column({ name: 'facture_url', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  factureUrl: string | null;

  /** Numéro Mobile Money utilisé pour la confirmation du paiement. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  telephone: string | null;

  /**
   * Page de paiement a ouvrir, quand le prestataire en impose une.
   *
   * Nulle en paiement direct : la demande part sur le telephone du payeur sans
   * page intermediaire. Non nulle, le client doit y envoyer le payeur, sans
   * quoi le reglement reste impossible.
   *
   * **Effacee des que le paiement est tranche.** Un lien conserve apres coup
   * n'a plus d'usage, et laisser un moyen de payer ce qui est deja regle ou
   * refuse ne peut produire qu'une confusion.
   */
  @Column({ name: 'url_paiement', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  urlPaiement: string | null;
}
