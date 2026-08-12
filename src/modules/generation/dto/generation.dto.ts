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

  @ApiProperty({ example: 'ATLAS', description: 'Nom du bureau COCFET.' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  nom: string;

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

/**
 * Clé d'une déclinaison de logo.
 *
 * Le préfixe est imposé. Sans lui, n'importe quelle clé de stockage pourrait
 * être rattachée au mandat — le CV d'un finissant, par exemple, que le service
 * d'identité visuelle irait alors lire et joindre aux documents sortants. Seul
 * ce qui a été déposé avec l'usage « logo » est recevable.
 */
export class CleLogoDto {
  @ApiProperty({ example: 'logos/6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e.png' })
  @IsString()
  @MaxLength(300)
  @Matches(/^logos\/[a-zA-Z0-9._-]+$/, {
    message:
      'La clé doit désigner un fichier déposé avec l’usage « logo » (préfixe logos/).',
  })
  logo: string;
}

/**
 * Ce que le frontend charge au démarrage pour s'habiller.
 *
 * Les champs sont nuls et les couleurs neutres tant qu'aucune génération n'est
 * active : une plateforme fraîchement installée doit pouvoir s'afficher.
 */
export class ThemeGeneration {
  @ApiProperty({ example: 2027, nullable: true })
  annee: number | null;

  @ApiProperty({ example: 'ATLAS', nullable: true })
  nom: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Clé de stockage du logo désigné.',
  })
  logo: string | null;

  @ApiProperty({ example: '#0F172A' })
  couleurPrimaire: string;

  @ApiProperty({ example: '#D4AF37' })
  couleurSecondaire: string;
}
