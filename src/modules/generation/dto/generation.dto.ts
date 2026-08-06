import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Bornes de l'année d'une génération.
 *
 * Larges à dessein : la plateforme est multi-générations et doit pouvoir
 * accueillir les promotions passées comme celles à venir. Le but n'est pas de
 * deviner l'année juste, mais d'écarter une saisie manifestement erronée —
 * `20227` au lieu de `2027`.
 */
export const ANNEE_MINIMALE = 2000;
export const ANNEE_MAXIMALE = 2100;

/** Code hexadécimal à 6 chiffres, dièse compris. */
const COULEUR = /^#[0-9a-fA-F]{6}$/;

export class CreerGenerationDto {
  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(ANNEE_MINIMALE)
  @Max(ANNEE_MAXIMALE)
  annee: number;

  @ApiProperty({ example: 'Promotion 2027' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  nom: string;

  @ApiPropertyOptional({ description: 'Clé de l’objet dans le stockage.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  logo?: string;

  @ApiPropertyOptional({ example: '#1d4ed8' })
  @Matches(COULEUR, {
    message: 'couleurPrimaire doit être un code hexadécimal, ex. #1d4ed8',
  })
  @IsOptional()
  couleurPrimaire?: string;

  @ApiPropertyOptional({ example: '#f8fafc' })
  @Matches(COULEUR, {
    message: 'couleurSecondaire doit être un code hexadécimal, ex. #f8fafc',
  })
  @IsOptional()
  couleurSecondaire?: string;
}

/**
 * `annee` reste modifiable, `isActive` non.
 *
 * L'activation passe par son propre endpoint : elle désactive la génération
 * précédente et recalcule le statut de finissant de toute la plateforme. Ce
 * n'est pas un champ que l'on bascule au passage d'une mise à jour de logo.
 */
export class MettreAJourGenerationDto extends PartialType(CreerGenerationDto) {}

/** Ce que le frontend charge au démarrage pour s'habiller. */
export interface ThemeGeneration {
  annee: number | null;
  nom: string | null;
  logo: string | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
}
