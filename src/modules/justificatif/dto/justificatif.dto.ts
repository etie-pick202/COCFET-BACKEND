import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OrigineTransaction } from '../../paiement/entities/transaction.entity';
import { StatutJustificatif } from '../entities/justificatif-paiement.entity';

export class SoumettreJustificatifDto {
  @ApiProperty({ description: 'Référence du règlement à justifier.' })
  @IsString()
  @MaxLength(120)
  reference: string;

  /**
   * Le préfixe est imposé. Sans lui, n'importe quelle clé du stockage pourrait
   * être présentée comme preuve — le CV d'un finissant, le logo du mandat —
   * et la trésorerie validerait en regardant une image sans rapport.
   */
  @ApiProperty({ example: 'justificatifs/6b1f9c2e-4a1f.png' })
  @IsString()
  @MaxLength(300)
  @Matches(/^justificatifs\/[a-zA-Z0-9._-]+$/, {
    message:
      'La clé doit désigner un fichier déposé avec l’usage « justificatif ».',
  })
  cle: string;

  @ApiProperty({ example: 5000, description: 'Montant déclaré, en FCFA.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  montantDeclare: number;
}

export class RefuserJustificatifDto {
  @ApiProperty({
    example: 'La capture ne montre ni le montant ni la date.',
    description:
      'Motif du refus. Exigé : sans lui, la personne ne sait pas quoi ' +
      'corriger et redéposera la même image.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  motif: string;
}

export class FiltreJustificatifDto {
  @ApiPropertyOptional({ enum: StatutJustificatif })
  @IsEnum(StatutJustificatif)
  @IsOptional()
  statut?: StatutJustificatif;

  @ApiPropertyOptional({ enum: OrigineTransaction })
  @IsEnum(OrigineTransaction)
  @IsOptional()
  origine?: OrigineTransaction;

  @ApiPropertyOptional({ description: 'Pièces d’un règlement précis.' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  reference?: string;
}
