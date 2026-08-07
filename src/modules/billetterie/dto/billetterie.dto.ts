import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
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
    description: 'Obligatoire pour un événement payant, ignoré sinon.',
  })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({
    example: '+237699000002',
    description: 'Numéro Mobile Money. Obligatoire pour un événement payant.',
  })
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephone doit être un numéro valide, ex. +237699000002',
  })
  @IsOptional()
  telephone?: string;
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
