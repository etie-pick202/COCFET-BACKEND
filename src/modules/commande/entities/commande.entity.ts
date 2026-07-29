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
  user: User;

  @OneToMany(() => LigneCommande, (ligne) => ligne.commande, { cascade: true })
  lignes: LigneCommande[];

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({
    type: 'enum',
    enum: StatutCommande,
    default: StatutCommande.EN_ATTENTE,
  })
  statut: StatutCommande;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  methodePaiement: MethodePaiement | null;

  @Column({
    name: 'statut_paiement',
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  statutPaiement: StatutPaiement;

  @Column({ name: 'facture_url', type: 'varchar', nullable: true })
  factureUrl: string | null;

  /** Numéro Mobile Money utilisé pour la confirmation du paiement. */
  @Column({ type: 'varchar', nullable: true })
  telephone: string | null;
}
