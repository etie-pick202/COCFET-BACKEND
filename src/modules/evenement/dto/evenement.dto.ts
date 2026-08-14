import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
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
import {
  ControleAcces,
  StatutEvenement,
  TypeEvenement,
} from '../entities/evenement.entity';

export class CreerEvenementDto {
  @ApiProperty({ example: 'Gala des finissants 2027' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  titre: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @ApiProperty({ example: '2027-08-12T18:00:00.000Z' })
  @IsDateString()
  dateDebut: string;

  @ApiPropertyOptional({ example: '2027-08-12T23:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  dateFin?: string;

  @ApiProperty({ example: 'Campus UCAC-ICAM, Douala' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  lieu: string;

  @ApiPropertyOptional({ example: 'https://maps.example/xyz' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  @IsOptional()
  lieuUrl?: string;

  @ApiPropertyOptional({ enum: TypeEvenement, default: TypeEvenement.GRATUIT })
  @IsEnum(TypeEvenement)
  @IsOptional()
  type?: TypeEvenement;

  /**
   * Tarifs en FCFA. Entiers : la devise n'a pas de sous-unité, et une décimale
   * produirait un écart silencieux avec le relevé du prestataire de paiement.
   */
  @ApiPropertyOptional({ example: 5000, description: 'FCFA, entier.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  prixCampus?: number;

  @ApiPropertyOptional({ example: 10000, description: 'FCFA, entier.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  prixExterne?: number;

  @ApiPropertyOptional({
    example: 200,
    description: '0 signifie « sans limite ».',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  capaciteMax?: number;

  @ApiPropertyOptional({
    enum: ControleAcces,
    default: ControleAcces.QR_FIXE,
    description:
      'AUCUN : aucun billet n’est émis, l’inscription sert à compter. ' +
      'QR_FIXE : billet envoyé par email, présentable hors ligne. ' +
      'QR_TOURNANT : code renouvelé toutes les 30 s dans l’application, ni ' +
      'téléchargeable ni envoyé — une capture d’écran transmise arrive ' +
      'périmée, au prix d’exiger du réseau à l’entrée.',
  })
  @IsEnum(ControleAcces)
  @IsOptional()
  controleAcces?: ControleAcces;

  @ApiPropertyOptional({ description: 'Clé de l’objet dans le stockage.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  imageCouverture?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Vrai : un inscrit peut deposer une capture de paiement, soumise a la ' +
      'validation de la tresorerie. Ferme par defaut — ouvrir partout ' +
      'exposerait chaque inscription a une preuve fabriquee.',
  })
  @IsBoolean()
  @IsOptional()
  accepteJustificatif?: boolean;
}

/**
 * Tous les champs deviennent facultatifs, sauf le statut : il ne se modifie
 * que par les endpoints dédiés, qui portent chacun leurs propres contrôles.
 */
export class MettreAJourEvenementDto extends PartialType(CreerEvenementDto) {}

export class FiltreEvenementDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TypeEvenement })
  @IsEnum(TypeEvenement)
  @IsOptional()
  type?: TypeEvenement;

  @ApiPropertyOptional({
    enum: StatutEvenement,
    description:
      'Réservé aux administrateurs. Le public ne voit que les événements publiés.',
  })
  @IsEnum(StatutEvenement)
  @IsOptional()
  statut?: StatutEvenement;

  @ApiPropertyOptional({
    description: 'true = uniquement les événements à venir.',
  })
  // Un paramètre de requête arrive en chaîne : sans cette transformation,
  // « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  @IsOptional()
  aVenir?: boolean;

  @ApiPropertyOptional({ description: 'Recherche sur le titre et le lieu.' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  recherche?: string;
}

/** Ce que l'API renvoie en plus de l'entité, calculé pour le demandeur. */
export class EvenementAvecTarif {
  @ApiProperty({
    example: 5000,
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
    example: 42,
    nullable: true,
    description: 'Nul quand la capacité est illimitée.',
  })
  placesRestantes: number | null;

  @ApiProperty()
  complet: boolean;
}
