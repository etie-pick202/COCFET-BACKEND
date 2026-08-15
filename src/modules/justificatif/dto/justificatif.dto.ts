import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
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

/**
 * Ce que la tresorerie constate en validant une piece.
 *
 * « montantRecu » n'est pas « montantDeclare » : le declare est ce que le
 * payeur affirme avoir verse, le recu ce que la tresorerie certifie. Seul le
 * second entre en comptabilite, et les garder tous les deux rend les ecarts
 * visibles.
 *
 * « recuParId » n'est pas le validateur : on remet l'argent au tresorier, et
 * c'est peut-etre quelqu'un d'autre qui valide la piece le lendemain.
 * Confondre les deux rendrait sans reponse la question de savoir qui detient
 * quoi.
 */
export class ValiderJustificatifDto {
  @ApiProperty({
    example: 5000,
    description: 'Montant reellement recu, en FCFA.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  montantRecu: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Membre des finances entre les mains de qui est passe l’argent. ' +
      'A defaut, le validateur est repute l’avoir recu.',
  })
  @IsUUID()
  @IsOptional()
  recuParId?: string;
}
