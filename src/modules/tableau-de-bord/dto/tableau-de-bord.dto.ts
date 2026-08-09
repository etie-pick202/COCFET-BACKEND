import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { OrigineTransaction } from '../../paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from '../../paiement/enums/paiement.enum';

/** Bornes d'analyse. Absentes, les indicateurs portent sur tout l'historique. */
export class PeriodeDto {
  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  depuis?: string;

  @ApiPropertyOptional({ example: '2027-12-31T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  jusqua?: string;
}

export class FiltreTransactionDto extends PeriodeDto {
  @ApiPropertyOptional({ enum: OrigineTransaction })
  @IsEnum(OrigineTransaction)
  @IsOptional()
  origine?: OrigineTransaction;

  @ApiPropertyOptional({ enum: StatutPaiement })
  @IsEnum(StatutPaiement)
  @IsOptional()
  statut?: StatutPaiement;

  @ApiPropertyOptional({ enum: MethodePaiement })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limite?: number = 20;
}

/** Un montant et ce qu'il représente. Les montants sont en FCFA, entiers. */
export class MontantVentile {
  @ApiProperty({ example: 'EVENEMENT' })
  libelle: string;

  @ApiProperty({ example: 450_000, description: 'En FCFA.' })
  montant: number;

  @ApiProperty({ example: 37, description: 'Nombre de transactions.' })
  nombre: number;
}

export class PointTemporel {
  @ApiProperty({ example: '2027-08', description: 'Mois au format AAAA-MM.' })
  mois: string;

  @ApiProperty({ example: 320_000 })
  montant: number;

  @ApiProperty({ example: 24 })
  nombre: number;
}

export class ClassementEntree {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Gala des finissants' })
  libelle: string;

  @ApiProperty({ example: 750_000 })
  montant: number;

  @ApiProperty({
    example: 150,
    description: 'Inscriptions, exemplaires vendus, ou commandes selon le cas.',
  })
  quantite: number;
}

/**
 * Tout ce que la trésorerie voit, et elle seule.
 *
 * Les montants ne comptent que les paiements **aboutis** : additionner les
 * paiements en attente donnerait une recette qui n'existe pas encore, et
 * l'écart avec le relevé du prestataire serait attribué à un bug.
 */
export class TableauTresorerie {
  @ApiProperty({
    example: 1_250_000,
    description: 'Recettes encaissées, FCFA.',
  })
  recettesTotales: number;

  @ApiProperty({ example: 320_000, description: 'Recettes du mois en cours.' })
  recettesDuMois: number;

  @ApiProperty({ example: 148 })
  transactionsAbouties: number;

  @ApiProperty({ example: 12, description: 'Paiements encore en attente.' })
  transactionsEnAttente: number;

  @ApiProperty({ example: 9 })
  transactionsEchouees: number;

  @ApiProperty({
    example: 8_446,
    description: 'Recette moyenne par transaction aboutie, FCFA.',
  })
  panierMoyen: number;

  @ApiProperty({
    type: [MontantVentile],
    description: 'Billetterie contre boutique.',
  })
  parOrigine: MontantVentile[];

  @ApiProperty({
    type: [MontantVentile],
    description: 'MTN MoMo contre Orange Money.',
  })
  parMethode: MontantVentile[];

  @ApiProperty({ type: [PointTemporel], description: 'Douze derniers mois.' })
  parMois: PointTemporel[];

  @ApiProperty({
    type: [ClassementEntree],
    description: 'Événements les plus rentables.',
  })
  meilleursEvenements: ClassementEntree[];

  @ApiProperty({
    type: [ClassementEntree],
    description: 'Articles les plus vendus.',
  })
  meilleursProduits: ClassementEntree[];

  @ApiProperty({
    type: [ClassementEntree],
    description: 'Comptes ayant le plus dépensé.',
  })
  meilleursContributeurs: ClassementEntree[];
}

/** Indicateurs ouverts à tout le bureau : rien d'argent ici. */
export class TableauGeneral {
  @ApiProperty({ example: 412 })
  comptes: number;

  @ApiProperty({ example: 87 })
  finissants: number;

  @ApiProperty({ example: 14 })
  evenementsPublies: number;

  @ApiProperty({ example: 3 })
  evenementsAVenir: number;

  @ApiProperty({ example: 356, description: 'Billets valides émis.' })
  inscriptions: number;

  @ApiProperty({ example: 210, description: 'Billets scannés à l’entrée.' })
  presences: number;

  @ApiProperty({
    example: 59,
    description: 'Taux de présence en pourcentage, arrondi.',
  })
  tauxPresence: number;

  @ApiProperty({ example: 8 })
  sponsors: number;

  @ApiProperty({ example: 23 })
  produits: number;

  @ApiProperty({ example: 41, description: 'Commandes payées ou au-delà.' })
  commandes: number;
}
