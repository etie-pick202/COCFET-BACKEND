import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { InviterSponsorDto } from './inviter-sponsor.dto';
import { TailleLogo } from '../entities/palier-sponsor.entity';

/**
 * Modification d'un partenaire.
 *
 * L'adresse en est **volontairement absente** : elle sert d'identifiant de
 * connexion, et la changer ici déconnecterait le partenaire de son compte sans
 * qu'il en soit averti. Un changement d'adresse passe par une nouvelle
 * invitation.
 */
export class MettreAJourSponsorDto extends PartialType(
  PickType(InviterSponsorDto, [
    'nom',
    'secteur',
    'description',
    'siteWeb',
  ] as const),
) {
  @ApiPropertyOptional({ description: 'Clé de l’objet dans le stockage.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  logo?: string;
}

/** Réservé à l'administration : le palier conditionne l'accès à l'annuaire. */
export class ChangerPalierDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsUUID()
  @IsOptional()
  palierId?: string | null;
}

export class FiltreSponsorDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filtrer sur un palier.' })
  @IsUUID()
  @IsOptional()
  palierId?: string;
}

export class CreerPalierDto {
  @ApiPropertyOptional({ example: 'Or' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nom: string;

  @ApiPropertyOptional({ example: 1, description: '1 = palier le plus élevé.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  ordre?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  accesAnnuaire?: boolean;

  @ApiPropertyOptional({ description: '0 = aucune consultation autorisée.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxConsultationsProfils?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  maxTelechargementsCv?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiPropertyOptional({ enum: TailleLogo })
  @IsEnum(TailleLogo)
  @IsOptional()
  tailleLogo?: TailleLogo;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  statsDetaillees?: boolean;
}

export class MettreAJourPalierDto extends PartialType(CreerPalierDto) {}

/** Vue publique d'un partenaire : ni email, ni quotas, ni statistiques. */
export interface SponsorPublic {
  id: string;
  nom: string;
  logo: string | null;
  description: string | null;
  siteWeb: string | null;
  secteur: string | null;
  palier: { nom: string; ordre: number; tailleLogo: TailleLogo } | null;
}
