import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';

/** Longueur maximale d'une compétence, pour éviter les phrases entières. */
const COMPETENCE_MAX = 40;

/**
 * Normalise une liste de compétences.
 *
 * Sans normalisation, « React », « react » et « ReactJS » deviennent trois
 * entrées distinctes, et la recherche par compétence ne trouve plus rien. On
 * ramène la casse et les espaces, et on écarte les doublons.
 */
const normaliserCompetences = (valeur: unknown): string[] => {
  if (!Array.isArray(valeur)) {
    return [];
  }

  const propres = valeur
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((c) => c.length > 0 && c.length <= COMPETENCE_MAX);

  return [...new Set(propres)];
};

export class CreerProfilDto {
  @ApiProperty({ example: 'Génie logiciel' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  filiere: string;

  @ApiPropertyOptional({ type: [String], example: ['nestjs', 'postgresql'] })
  @Transform(({ value }: { value: unknown }) => normaliserCompetences(value))
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  @IsOptional()
  competences?: string[];

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({ example: 'https://www.linkedin.com/in/exemple' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(255)
  @IsOptional()
  linkedinUrl?: string;

  @ApiPropertyOptional({ example: 'https://github.com/exemple' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(255)
  @IsOptional()
  githubUrl?: string;

  @ApiPropertyOptional({ example: 'https://exemple.dev' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(255)
  @IsOptional()
  portfolioUrl?: string;

  @ApiPropertyOptional({ description: 'Clé de stockage de la photo.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  photo?: string;

  @ApiPropertyOptional({ description: 'Clé de stockage du CV.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  cvUrl?: string;
}

/**
 * `isVisible` est **absent** : la visibilité se règle par son propre endpoint.
 *
 * Elle relève du consentement de la personne à figurer dans un annuaire
 * consulté par des entreprises. La mêler aux autres champs la ferait basculer
 * au détour d'une mise à jour de biographie.
 */
export class MettreAJourProfilFinissantDto extends PartialType(
  CreerProfilDto,
) {}

export class ChangerVisibiliteDto {
  @ApiProperty()
  @IsBoolean()
  isVisible: boolean;
}

export class RechercheAnnuaireDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(120)
  @IsOptional()
  filiere?: string;

  @ApiPropertyOptional({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  promotion?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Profils possédant **toutes** les compétences demandées.',
  })
  @Transform(({ value }: { value: unknown }) =>
    normaliserCompetences(Array.isArray(value) ? value : [value]),
  )
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  competences?: string[];

  @ApiPropertyOptional({
    description: 'Recherche sur le nom et la biographie.',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  recherche?: string;
}

/**
 * Vue de liste : ce qu'un sponsor voit **sans consommer son quota**.
 *
 * Ni CV, ni liens externes, ni biographie complète. Une liste qui livrerait
 * tout rendrait le quota décoratif : il suffirait de parcourir les pages.
 */
export interface ProfilResume {
  id: string;
  prenom: string;
  nom: string;
  photo: string | null;
  filiere: string;
  promotion: number | null;
  competences: string[];
}

/** Vue détaillée, décomptée du quota de consultations. */
export interface ProfilDetail extends ProfilResume {
  bio: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  aUnCv: boolean;
}

/** État des quotas d'un sponsor, pour son tableau de bord. */
export interface QuotasSponsor {
  consultationsProfils: { utilise: number; plafond: number };
  telechargementsCv: { utilise: number; plafond: number };
}
