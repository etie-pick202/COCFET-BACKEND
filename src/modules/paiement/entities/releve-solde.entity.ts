import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * Photographie du solde chez le prestataire, à un instant donné.
 *
 * Une ligne n'est ajoutée que lorsque quelque chose a bougé, ou une fois par
 * jour : l'historique du solde se relit ainsi sans que la table grossisse à
 * chaque passage de la synchronisation. `verifieLe` avance, lui, à chaque
 * lecture réussie — c'est lui qui dit si le chiffre affiché est frais.
 *
 * Les trois montants sont figés ensemble : `encaisseNet` et `retraitsReussis`
 * sont ceux que **nous** calculions au moment de la photographie, pour que
 * l'écart de ce jour-là reste vérifiable des mois plus tard, même si le
 * calcul évolue.
 */
@Entity('releves_solde')
export class ReleveSolde extends BaseEntity {
  /** Solde chez Fapshi, en FCFA. */
  @Column({ name: 'solde_fapshi', type: 'int' })
  soldeFapshi: number;

  @Column({ default: 'XAF' })
  devise: string;

  /**
   * Encaissé net par notre application : débité moins frais du prestataire,
   * sur les seuls paiements passés par Fapshi.
   */
  @Column({ name: 'encaisse_net', type: 'int' })
  encaisseNet: number;

  /** Somme des retraits aboutis relevés chez Fapshi. */
  @Column({ name: 'retraits_reussis', type: 'int' })
  retraitsReussis: number;

  @Column({ name: 'verifie_le', type: 'timestamptz' })
  verifieLe: Date;
}
