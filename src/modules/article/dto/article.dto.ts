import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import { StatutArticle } from '../entities/article.entity';

export class CreerArticleDto {
  @ApiProperty({ example: 'Retour sur le gala des finissants' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  titre: string;

  @ApiProperty({ description: 'Corps de l’article.' })
  @IsString()
  @MinLength(10)
  @MaxLength(50_000)
  contenu: string;

  @ApiPropertyOptional({
    description:
      'Résumé affiché dans les listes. Déduit du contenu s’il est omis : une ' +
      'liste d’articles sans accroche n’invite personne à cliquer.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  extrait?: string;

  @ApiPropertyOptional({ description: 'Clé de l’objet dans le stockage.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  imageCouverture?: string;

  @ApiPropertyOptional({ example: 'Vie du campus' })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  categorie?: string;

  @ApiPropertyOptional({
    description: 'Événement que l’article couvre : annonce ou compte rendu.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string;
}

/**
 * Tous les champs deviennent facultatifs, sauf le statut : il ne se modifie que
 * par les endpoints dédiés, qui portent chacun leurs propres contrôles.
 */
export class MettreAJourArticleDto extends PartialType(CreerArticleDto) {}

export class PublierArticleDto {
  @ApiPropertyOptional({
    example: '2027-09-01T08:00:00.000Z',
    description:
      'Date de parution. Omise, la publication est immédiate. Dans le futur, ' +
      'l’article est programmé : il reste invisible et la diffusion partira à ' +
      'l’heure dite.',
  })
  @IsDateString()
  @IsOptional()
  le?: string;
}

export class FiltreArticleDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'Vie du campus' })
  @IsString()
  @MaxLength(80)
  @IsOptional()
  categorie?: string;

  @ApiPropertyOptional({
    enum: StatutArticle,
    description:
      'Réservé aux administrateurs. Le public ne voit que les articles parus.',
  })
  @IsEnum(StatutArticle)
  @IsOptional()
  statut?: StatutArticle;

  @ApiPropertyOptional({ description: 'Recherche sur le titre et l’extrait.' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  recherche?: string;

  @ApiPropertyOptional({
    description: 'Filtre les articles couvrant cet événement.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string;

  @ApiPropertyOptional({
    description:
      'Réservé aux administrateurs : true = articles programmés dont l’heure ' +
      'de parution n’est pas encore venue.',
  })
  // Un paramètre de requête arrive en chaîne : sans cette transformation,
  // « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsOptional()
  programmes?: boolean;
}
