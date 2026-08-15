import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ValidateNested,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import { CategorieProduit, StatutProduit } from '../entities/produit.entity';

export class CreerProduitDto {
  @ApiProperty({ example: 'Sweat capuche promo 2027' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  nom: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  /**
   * Tarifs en FCFA. Entiers : la devise n'a pas de sous-unité, et une décimale
   * produirait un écart silencieux avec le relevé du prestataire de paiement.
   */
  @ApiPropertyOptional({ example: 12000, description: 'FCFA, entier.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  prixCampus?: number;

  @ApiPropertyOptional({ example: 15000, description: 'FCFA, entier.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  prixExterne?: number;

  @ApiPropertyOptional({
    enum: CategorieProduit,
    default: CategorieProduit.GOODIES,
  })
  @IsEnum(CategorieProduit)
  @IsOptional()
  categorie?: CategorieProduit;

  @ApiPropertyOptional({
    type: [String],
    example: ['S', 'M', 'L', 'XL'],
    description: 'Déclinaisons proposées. Vide pour un article sans taille.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  @IsOptional()
  tailles?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Noir', 'Blanc'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  @IsOptional()
  couleurs?: string[];

  @ApiPropertyOptional({ example: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Clés de stockage — à échanger contre des URL signées.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Rattachement facultatif à un événement.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string;

  @ApiPropertyOptional({
    example: '2027-09-01T00:00:00.000Z',
    description: 'Date de disponibilité prévue, pour une précommande.',
  })
  @IsDateString()
  @IsOptional()
  datePrecommande?: string;
}

/**
 * Tous les champs deviennent facultatifs, sauf le stock : il ne se corrige que
 * par l'endpoint dédié, dont l'écriture est atomique. Le poser ici écraserait
 * une valeur qu'une commande simultanée vient de décrémenter.
 */
export class MettreAJourProduitDto extends PartialType(CreerProduitDto) {}

export class FiltreProduitDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CategorieProduit })
  @IsEnum(CategorieProduit)
  @IsOptional()
  categorie?: CategorieProduit;

  @ApiPropertyOptional({
    enum: StatutProduit,
    description:
      'Réservé aux administrateurs. Le public ne voit jamais les produits retirés.',
  })
  @IsEnum(StatutProduit)
  @IsOptional()
  statut?: StatutProduit;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  evenementId?: string;

  @ApiPropertyOptional({
    description: 'Recherche sur le nom et la description.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  recherche?: string;

  @ApiPropertyOptional({
    description: 'true = uniquement ce qui peut être commandé aujourd’hui.',
  })
  // Un paramètre de requête arrive en chaîne : sans cette transformation,
  // « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsOptional()
  disponibleSeulement?: boolean;
}

/**
 * Correction de stock, en relatif et non en absolu.
 *
 * Poser une valeur absolue écraserait ce qu'une commande simultanée vient de
 * décrémenter : deux réapprovisionnements concurrents se perdraient l'un
 * l'autre. Un delta s'applique sans lire d'abord.
 */
export class AjusterStockDto {
  @ApiProperty({
    example: 20,
    description:
      'Positif pour réapprovisionner, négatif pour corriger à la baisse. ' +
      'Le stock ne peut jamais devenir négatif.',
  })
  @Type(() => Number)
  @IsInt()
  quantite: number;
}

/** Ce que l'API renvoie en plus de l'entité, calculé pour le demandeur. */
export class ProduitAvecTarif {
  @ApiProperty({
    example: 12000,
    description:
      'En FCFA. Ne découle pas du rôle mais de la promotion : un ancien reste ' +
      'STUDENT et paie pourtant le tarif externe.',
  })
  prixApplicable: number;

  @ApiProperty({
    description: 'Vrai si le demandeur bénéficie du tarif campus.',
  })
  tarifCampus: boolean;

  @ApiProperty({
    description:
      'Vrai si l’article peut être commandé maintenant : en stock, ou ouvert ' +
      'à la précommande.',
  })
  commandable: boolean;
}

export class DeclinaisonDto {
  @ApiPropertyOptional({ example: 'M', nullable: true })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  taille?: string | null;

  @ApiPropertyOptional({ example: 'Noir', nullable: true })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  couleur?: string | null;

  @ApiProperty({ example: 12, description: 'Quantite disponible.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;
}

/**
 * Grille complete des declinaisons.
 *
 * Remplacement global plutot que retouche ligne a ligne : le bureau saisit une
 * grille — tailles fois couleurs — et la corrige en bloc. La somme devient le
 * stock du produit, qui cesse d'etre saisi directement.
 */
export class DefinirDeclinaisonsDto {
  @ApiProperty({ type: [DeclinaisonDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DeclinaisonDto)
  declinaisons: DeclinaisonDto[];
}
