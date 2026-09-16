import { ApiProperty } from '@nestjs/swagger';
import { Column } from 'typeorm';

/**
 * Détail des frais répercutés sur l'acheteur, intégré à la fois dans
 * Inscription et dans Commande.
 *
 * Une seule déclaration des trois colonnes, plutôt que redite à l'identique
 * dans les deux entités : le calcul et la raison d'être de chaque frais
 * restent dans frais-paiement.ts, cette classe ne porte que leur forme en
 * base.
 *
 * **Noms de colonnes explicites**, sur chaque `@Column` : embarquée avec
 * `{ prefix: false }`, TypeORM préfixerait sinon chaque colonne du nom de la
 * propriété porteuse (« frais_fraisFapshi »…), ce qui romprait la migration
 * déjà écrite pour « frais_fapshi », « frais_retrait », « montant_ttc ».
 *
 * Nulles sur un événement gratuit, où rien n'est encaissé, et sur une
 * inscription ou une commande antérieure à cette fonctionnalité.
 */
export class FraisEncaissement {
  @Column({ name: 'frais_fapshi', type: 'int', nullable: true })
  @ApiProperty({ nullable: true })
  fraisFapshi: number | null;

  @Column({ name: 'frais_retrait', type: 'int', nullable: true })
  @ApiProperty({ nullable: true })
  fraisRetrait: number | null;

  /** Ce qui part réellement vers Fapshi — jamais le prix affiché seul. */
  @Column({ name: 'montant_ttc', type: 'int', nullable: true })
  @ApiProperty({ nullable: true })
  montantTtc: number | null;
}

/** Aucun frais calculé — événement gratuit, ou commande hors périmètre. */
export const AUCUN_FRAIS: FraisEncaissement = {
  fraisFapshi: null,
  fraisRetrait: null,
  montantTtc: null,
};
