import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  ValidateNested,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import { MethodePaiement } from '../../paiement/enums/paiement.enum';
import { StatutInscription } from '../entities/inscription.entity';

export class SInscrireDto {
  @ApiPropertyOptional({
    enum: MethodePaiement,
    description:
      'Facultative. Sans elle, le payeur choisit son opérateur sur la page de ' +
      'paiement hébergée, et les frais sont calculés au taux le plus élevé.',
  })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({
    example: '+237699000002',
    description:
      'Numéro Mobile Money. Facultatif : sans lui, le payeur le saisit sur la ' +
      'page de paiement hébergée.',
  })
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephone doit être un numéro valide, ex. +237699000002',
  })
  @IsOptional()
  telephone?: string;

  @ApiPropertyOptional({
    example: { 'taille-de-t-shirt': 'L' },
    description:
      'Choix demandés par l’événement (taille de T-shirt…), par clé d’option. ' +
      'Obligatoires pour les options obligatoires.',
  })
  @IsObject()
  @IsOptional()
  reponses?: Record<string, string>;
}

/** Plafond d'un paiement groupé, payeur compris. */
export const PARTICIPANTS_MAX = 5;

export class ParticipantDto {
  @ApiPropertyOptional({
    description: 'Le compte à inscrire. Absent : le payeur lui-même.',
  })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({
    example: { 'taille-de-t-shirt': 'L' },
    description:
      'Choix demandés par l’événement pour cette personne. Facultatifs pour ' +
      'un proche : sans eux, il est relancé avant la date de figeage.',
  })
  @IsObject()
  @IsOptional()
  reponses?: Record<string, string>;
}

export class InscrireGroupeDto {
  @ApiProperty({
    type: [ParticipantDto],
    description: `De 1 à ${PARTICIPANTS_MAX} personnes, payées d'un seul paiement.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARTICIPANTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];

  @ApiPropertyOptional({ enum: MethodePaiement })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({ example: '+237699000002' })
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephone doit être un numéro valide, ex. +237699000002',
  })
  @IsOptional()
  telephone?: string;
}

export class ModifierReponsesDto {
  @ApiProperty({
    example: { 'taille-de-t-shirt': 'XL' },
    description: 'Les nouveaux choix, par clé d’option.',
  })
  @IsObject()
  reponses: Record<string, string>;
}

export class FiltreInscriptionDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StatutInscription })
  @IsEnum(StatutInscription)
  @IsOptional()
  statut?: StatutInscription;

  @ApiPropertyOptional({
    description: 'true = uniquement les événements à venir.',
  })
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsOptional()
  aVenir?: boolean;
}

export class ScannerBilletDto {
  @ApiProperty({
    example: 'COCFET-A1B2C3D4',
    description:
      'Contenu lu dans le QR : le code d’entrée, ou le jeton tournant qui le ' +
      'porte quand l’événement l’exige.',
  })
  @IsString()
  @MaxLength(120)
  codeBillet: string;
}

/** Ce qu'affiche l'application au moment de présenter le billet. */
export class CodeBillet {
  @ApiProperty({
    description: 'Image PNG en URL de données, prête pour un « img ».',
  })
  qrCode: string;

  @ApiProperty({
    description:
      'Vrai si le code se renouvelle. L’image doit alors être redemandée, ' +
      'jamais mise en cache ni enregistrée.',
  })
  tournant: boolean;

  @ApiProperty({
    nullable: true,
    example: 23,
    description:
      'Secondes avant renouvellement. Nul sur un billet à code fixe, qui ne ' +
      'périme pas.',
  })
  expireDans: number | null;
}

/** Qui l'on place au contrôle d'un événement. */
export class AffecterScannerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;
}
