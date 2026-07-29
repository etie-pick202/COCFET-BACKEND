import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

export enum TypeActivite {
  INSCRIPTION = 'INSCRIPTION',
  PAIEMENT = 'PAIEMENT',
  SCAN = 'SCAN',
  VOTE = 'VOTE',
  COMMANDE = 'COMMANDE',
  ARTICLE = 'ARTICLE',
  UTILISATEUR = 'UTILISATEUR',
  EVENEMENT = 'EVENEMENT',
}

/** Alimente le flux en direct du dashboard d'administration. */
@Entity('journal_activite')
export class JournalActivite extends BaseEntity {
  @Column({ type: 'enum', enum: TypeActivite })
  type: TypeActivite;

  @Column({ type: 'text' })
  message: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
