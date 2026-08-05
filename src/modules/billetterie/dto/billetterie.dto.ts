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
  @ApiProperty({ example: 'COCFET-A1B2C3D4' })
  @IsString()
  @MaxLength(40)
  codeBillet: string;
}
