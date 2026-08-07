import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import { Role } from '../../../common/enums/role.enum';
import { TypeNotification } from '../entities/notification.entity';

/** Filtres de la liste des notifications d'un utilisateur. */
export class FiltreNotificationDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TypeNotification })
  @IsEnum(TypeNotification)
  @IsOptional()
  type?: TypeNotification;

  @ApiPropertyOptional({ description: 'true = seulement les non lues.' })
  // Un paramètre de requête arrive toujours en chaîne : sans cette
  // transformation, « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  nonLues?: boolean;
}

/** Notification adressée à un utilisateur précis, par l'administration. */
export class CreerNotificationDto {
  @ApiProperty({ enum: TypeNotification })
  @IsEnum(TypeNotification)
  type: TypeNotification;

  @ApiProperty({ example: 'Votre billet est confirmé' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  titre: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    example: '/evenements/gala-2027',
    description: 'Chemin interne à ouvrir au clic.',
  })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  lien?: string;
}

/**
 * Diffusion à un ensemble de destinataires.
 *
 * Le ciblage est volontairement limité au rôle et à la promotion : ce sont les
 * deux découpages qui ont un sens ici, et une liste d'identifiants libre
 * ouvrirait la porte à des envois de masse arbitraires.
 */
export class DiffuserNotificationDto extends CreerNotificationDto {
  @ApiPropertyOptional({ enum: Role, isArray: true })
  @IsEnum(Role, { each: true })
  @IsOptional()
  roles?: Role[];

  @ApiPropertyOptional({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @IsOptional()
  promotion?: number;

  @ApiPropertyOptional({
    description: 'true = uniquement les finissants de la génération active.',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  finissantsSeulement?: boolean;
}

export class MettreAJourPreferenceDto {
  @ApiProperty({ enum: TypeNotification })
  @IsEnum(TypeNotification)
  type: TypeNotification;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  canalEmail?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  canalPush?: boolean;
}

/**
 * Réglages renvoyés à l'interface, un par type de notification.
 *
 * Décrit en classe alors que le service renvoie un objet littéral : sans
 * modèle nommé, le frontend générerait un type anonyme pour chaque route et
 * ne pourrait pas partager le composant qui affiche ces interrupteurs.
 */
export class PreferenceExposee {
  @ApiProperty({ enum: TypeNotification })
  type: TypeNotification;

  @ApiProperty({ description: 'Vrai par défaut, tant que rien n’a été réglé.' })
  canalEmail: boolean;

  @ApiProperty({ description: 'Vrai par défaut, tant que rien n’a été réglé.' })
  canalPush: boolean;
}

/** Pastille de l'interface. */
export class CompteNonLuesDto {
  @ApiProperty({ example: 3 })
  nonLues: number;
}

export class ResultatMarquageDto {
  @ApiProperty({
    example: 12,
    description: 'Nombre de notifications passées à « lue ».',
  })
  misAJour: number;
}

export class ResultatDiffusionDto {
  @ApiProperty({
    example: 148,
    description:
      'Nombre de comptes touchés, après exclusion des adresses non ' +
      'confirmées et des comptes désactivés.',
  })
  destinataires: number;
}

export class CreerRappelDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  evenementId: string;

  @ApiProperty({
    example: '2027-08-12T18:00:00.000Z',
    description: 'Date d’envoi du rappel. Doit être dans le futur.',
  })
  @IsString()
  dateRappel: string;

  @ApiPropertyOptional({ example: '/evenements/gala' })
  @IsUrl({ require_tld: false, require_protocol: false })
  @IsOptional()
  lien?: string;
}
