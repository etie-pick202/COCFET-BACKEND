import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { TrancheCotisation } from './tranche-cotisation.entity';

/**
 * Population appelée à cotiser.
 *
 * Décrite en termes du domaine et non en rôles bruts : « finissant » n'est pas
 * un rôle mais un statut calculé, et « alumni » n'en est pas un non plus. Les
 * confondre ferait cotiser les mauvaises personnes.
 */
export enum CibleCotisation {
  FINISSANT = 'FINISSANT',
  ETUDIANT = 'ETUDIANT',
  ALUMNI = 'ALUMNI',
  VISITEUR = 'VISITEUR',
  ADMIN = 'ADMIN',
}

export enum StatutCotisation {
  BROUILLON = 'BROUILLON',
  OUVERTE = 'OUVERTE',
  CLOSE = 'CLOSE',
}

/**
 * Somme que le bureau appelle une population à verser.
 *
 * Ce n'est pas un événement, et c'est pourquoi elle vit à part : on n'y
 * assiste pas, on n'y prend pas de place, il n'y a pas de billet. Ce qui la
 * caractérise est un **montant dû par personne**, éventuellement fractionné, et
 * suivi jusqu'à son solde.
 *
 * Seul un poste ayant l'accès aux finances peut en lancer une : appeler une
 * promotion entière à verser de l'argent engage le bureau, et n'est pas un
 * geste d'organisation courant.
 */
@Entity('cotisations')
export class Cotisation extends BaseEntity {
  @Column()
  @ApiProperty({ example: 'Cotisation des finissants 2027' })
  titre: string;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  description: string | null;

  /**
   * Montant dû par personne, en FCFA.
   *
   * Par personne et non au total : une cotisation appelle chacun à verser la
   * même somme. Un objectif global se déduit en multipliant par le nombre de
   * participants, jamais l'inverse.
   */
  @Column({ name: 'montant_total', type: 'int' })
  @ApiProperty({ description: 'Montant dû par personne, en FCFA.' })
  montantTotal: number;

  /** Populations appelées à verser. Cumulables. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  @ApiProperty({ enum: CibleCotisation, isArray: true })
  cibles: CibleCotisation[];

  @Index()
  @Column({
    type: 'enum',
    enum: StatutCotisation,
    default: StatutCotisation.BROUILLON,
  })
  @ApiProperty({ enum: StatutCotisation })
  statut: StatutCotisation;

  /**
   * Date au-delà de laquelle le solde restant est en retard.
   *
   * Distincte des dates limites de tranche : celles-ci jalonnent le parcours,
   * celle-ci le referme.
   */
  @Column({ name: 'date_limite', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  dateLimite: Date | null;

  /**
   * Autorise le règlement en plusieurs fois.
   *
   * Faux, la personne verse le montant en une fois. Vrai, elle verse ce
   * qu'elle veut quand elle veut, et les tranches disent où elle aurait dû en
   * être à chaque échéance.
   */
  @Column({ default: false })
  @ApiProperty()
  fractionnable: boolean;

  /**
   * Accepte les preuves de paiement remises hors de la plateforme.
   *
   * Faux par défaut : ouvrir ce chemin partout exposerait chaque cotisation à
   * une capture fabriquée, que seule la vigilance d'un valideur arrêterait.
   */
  @Column({ name: 'accepte_justificatif', default: false })
  @ApiProperty()
  accepteJustificatif: boolean;

  @OneToMany(() => TrancheCotisation, (tranche) => tranche.cotisation, {
    cascade: true,
  })
  @ApiProperty({ type: () => [TrancheCotisation] })
  tranches: TrancheCotisation[];
}
