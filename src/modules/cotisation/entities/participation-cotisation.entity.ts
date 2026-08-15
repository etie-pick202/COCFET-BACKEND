import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { Cotisation } from './cotisation.entity';

export enum StatutParticipation {
  EN_COURS = 'EN_COURS',
  SOLDEE = 'SOLDEE',
  EXEMPTEE = 'EXEMPTEE',
}

/**
 * Ce qu'une personne doit à une cotisation, et ce qu'elle a versé.
 *
 * **Son identifiant sert de référence de transaction.** C'est ce qui branche
 * les cotisations sur tout l'existant sans rien inventer : un paiement en
 * ligne, un justificatif remis en main propre, le journal de trésorerie et la
 * réconciliation fonctionnent déjà avec une référence et une origine.
 *
 * `montantDu` est **figé au moment où la personne devient concernée**, et
 * recopié depuis la cotisation plutôt que lu à travers elle. Sans cela,
 * relever le montant rendrait rétroactivement tout le monde en retard — y
 * compris ceux qui avaient déjà tout réglé.
 */
@Unique('uq_participation_cotisation_user', ['cotisation', 'user'])
@Entity('participations_cotisation')
export class ParticipationCotisation extends BaseEntity {
  @ManyToOne(() => Cotisation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cotisation_id' })
  @ApiProperty({ type: () => Cotisation })
  cotisation: Cotisation;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ type: () => User })
  user: User;

  /** Montant dû, figé à l'ouverture. */
  @Column({ name: 'montant_du', type: 'int' })
  @ApiProperty()
  montantDu: number;

  /**
   * Cumul des versements reconnus, en FCFA.
   *
   * Incrémenté en base plutôt que recalculé : deux règlements simultanés — un
   * paiement en ligne et la validation d'un justificatif — se lisent puis
   * s'écrivent, et le second écraserait le premier.
   */
  @Column({ name: 'montant_regle', type: 'int', default: 0 })
  @ApiProperty()
  montantRegle: number;

  @Index()
  @Column({
    type: 'enum',
    enum: StatutParticipation,
    default: StatutParticipation.EN_COURS,
  })
  @ApiProperty({ enum: StatutParticipation })
  statut: StatutParticipation;
}
