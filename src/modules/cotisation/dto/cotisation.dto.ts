import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CibleCotisation } from '../entities/cotisation.entity';

/** Au-delà, l'échéancier devient illisible et personne ne le suit. */
export const MAX_TRANCHES = 12;

/** Le FCFA n'a pas de sous-unité : tout montant est un entier. */
const MONTANT_MINIMAL = 1;

export class TrancheDto {
  @ApiProperty({ example: 1, description: 'Rang de l’échéance.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ordre: number;

  @ApiProperty({ example: 'Première tranche' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  libelle: string;

  @ApiProperty({ example: 10000, description: 'Montant de la tranche, FCFA.' })
  @Type(() => Number)
  @IsInt()
  @Min(MONTANT_MINIMAL)
  montant: number;

  @ApiProperty({ example: '2027-03-31T23:59:00.000Z' })
  @IsDateString()
  dateLimite: string;
}

export class CreerCotisationDto {
  @ApiProperty({ example: 'Cotisation des finissants 2027' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  titre: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 30000,
    description:
      'Montant dû **par personne**, en FCFA. Un objectif global se déduit en ' +
      'multipliant par le nombre de participants, jamais l’inverse.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(MONTANT_MINIMAL)
  montantTotal: number;

  @ApiProperty({
    enum: CibleCotisation,
    isArray: true,
    description:
      'Populations appelées à verser, cumulables. « Finissant » et « alumni » ' +
      'ne sont pas des rôles mais des statuts déduits de la promotion.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(CibleCotisation, { each: true })
  cibles: CibleCotisation[];

  @ApiPropertyOptional({ example: '2027-06-30T23:59:00.000Z' })
  @IsDateString()
  @IsOptional()
  dateLimite?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Autorise le règlement en plusieurs versements.',
  })
  @IsBoolean()
  @IsOptional()
  fractionnable?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Accepte les preuves de paiement remises hors de la plateforme. Faux ' +
      'par défaut : ouvrir ce chemin expose à une capture fabriquée.',
  })
  @IsBoolean()
  @IsOptional()
  accepteJustificatif?: boolean;

  @ApiPropertyOptional({
    type: [TrancheDto],
    description:
      'Échéancier. La somme des tranches doit égaler le montant dû — un ' +
      'écart est refusé, c’est une faute de saisie.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_TRANCHES)
  @ValidateNested({ each: true })
  @Type(() => TrancheDto)
  @IsOptional()
  tranches?: TrancheDto[];
}

/**
 * Ce qui reste modifiable **avant** l'ouverture, et rien après.
 *
 * Une fois ouverte, les montants sont figés dans les participations : les
 * changer ici ne les toucherait pas, et afficherait un montant que personne ne
 * doit réellement.
 */
export class MettreAJourCotisationDto extends PartialType(CreerCotisationDto) {}

export class DeclarerVersementDto {
  @ApiProperty({ example: 50000, description: 'Montant remis, en FCFA.' })
  @Type(() => Number)
  @IsInt()
  @Min(MONTANT_MINIMAL)
  montant: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Membre du bureau qui constate la remise.',
  })
  @IsUUID()
  @IsOptional()
  recuParId?: string;

  @ApiPropertyOptional({ example: 'Dépôt bancaire du 12 mars' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  note?: string;
}
