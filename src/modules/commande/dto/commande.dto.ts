import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import { MethodePaiement } from '../../paiement/enums/paiement.enum';
import { StatutCommande } from '../entities/commande.entity';

/** Quantité maximale par ligne : au-delà, c'est une commande de gros. */
const QUANTITE_MAX = 20;

export class LignePanierDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  produitId: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: QUANTITE_MAX })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(QUANTITE_MAX)
  quantite: number;

  @ApiPropertyOptional({
    example: 'M',
    description: 'Obligatoire si le produit propose des tailles.',
  })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  taille?: string;

  @ApiPropertyOptional({
    example: 'Noir',
    description: 'Obligatoire si le produit propose des couleurs.',
  })
  @IsString()
  @MaxLength(30)
  @IsOptional()
  couleur?: string;
}

export class CreerCommandeDto {
  @ApiProperty({ type: [LignePanierDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LignePanierDto)
  lignes: LignePanierDto[];

  @ApiProperty({ enum: MethodePaiement })
  @IsEnum(MethodePaiement)
  methodePaiement: MethodePaiement;

  @ApiProperty({
    example: '+237670000000',
    description: 'Numéro Mobile Money qui recevra la demande de paiement.',
  })
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephone doit être un numéro valide, ex. +237670000000',
  })
  telephone: string;
}

export class FiltreCommandeDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StatutCommande })
  @IsEnum(StatutCommande)
  @IsOptional()
  statut?: StatutCommande;
}

export class MarquerPreteDto {
  @ApiPropertyOptional({
    description: 'Lieu et horaires de retrait, transmis au client.',
    example: 'Bureau du COCFET, bâtiment A — du lundi au vendredi, 10h-16h.',
  })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  instructions?: string;
}
