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
  ValidateIf,
} from 'class-validator';
import { MethodePaiement } from '../../paiement/enums/paiement.enum';
import { TypeMouvementFonds } from '../entities/mouvement-fonds.entity';

/**
 * Ce qu'un membre déclare : de l'argent reçu, passé, déposé, rendu ou dépensé.
 *
 * Le membre qui déclare est toujours celui dont la poche bouge — l'auteur de la
 * remise. Pour la trésorerie qui saisit à la place d'un autre, `membreId`
 * désigne celui-ci.
 */
export class DeclarerMouvementDto {
  @ApiProperty({ enum: TypeMouvementFonds })
  @IsEnum(TypeMouvementFonds)
  type: TypeMouvementFonds;

  @ApiProperty({ example: 50000, description: 'Montant, en FCFA.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  montant: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Le membre dont la poche bouge. Absent : celui qui déclare. Permet à la ' +
      'trésorerie de saisir une remise pour un autre membre.',
  })
  @IsUUID()
  @IsOptional()
  membreId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Transfert : le membre qui reçoit.',
  })
  @ValidateIf((dto: DeclarerMouvementDto) => dto.contrepartieId !== undefined)
  @IsUUID()
  contrepartieId?: string;

  @ApiPropertyOptional({
    example: 'Le trésorier de la promotion',
    description:
      'Réception : de qui vient l’argent. Remboursement ou dépense : à qui ' +
      'il est rendu.',
  })
  @IsString()
  @MaxLength(150)
  @IsOptional()
  libelleTiers?: string;

  @ApiPropertyOptional({ example: 'Dépôt bancaire du 12 mars' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({
    description:
      'Clé du justificatif joint, déposé avec l’usage « justificatif ».',
  })
  @IsString()
  @MaxLength(300)
  @Matches(/^justificatifs\/[a-zA-Z0-9._-]+$/, {
    message:
      'La clé doit désigner un fichier déposé avec l’usage « justificatif ».',
  })
  @IsOptional()
  piece?: string;

  @ApiPropertyOptional({
    enum: MethodePaiement,
    description: 'Dépôt sur la plateforme : l’opérateur, s’il est déjà choisi.',
  })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({
    description: 'Dépôt sur la plateforme : le numéro à débiter.',
  })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  telephone?: string;
}

export class AttribuerRetraitDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'Le membre qui détient désormais l’argent retiré. Nul : le retrait ' +
      'redevient « non attribué ».',
  })
  @ValidateIf((_, valeur) => valeur !== null)
  @IsUUID()
  detenteurId: string | null;
}

/** Une personne, dite comme dans le suivi. */
export class PersonneFonds {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  nom: string;
}

/** Ce qu'un membre détient, et d'où cela vient. */
export class PocheMembre {
  @ApiProperty({ type: PersonneFonds })
  membre: PersonneFonds;

  @ApiProperty({
    description: 'Argent reçu par le membre : preuves validées et réceptions.',
  })
  recu: number;

  @ApiProperty({ description: 'Retraits Fapshi qui lui sont attribués.' })
  retire: number;

  @ApiProperty({ description: 'Transferts reçus d’autres membres.' })
  transfertsRecus: number;

  @ApiProperty({
    description: 'Transferts, dépôts, remboursements et dépenses sortis.',
  })
  sorti: number;

  @ApiProperty({
    description: 'Ce que le membre détient aujourd’hui : reçu - sorti.',
  })
  detient: number;

  @ApiProperty({
    description: 'Dépôts lancés sur la plateforme, pas encore confirmés.',
  })
  enRoute: number;
}

export class SuiviFonds {
  @ApiProperty({ description: 'Solde du compte Fapshi, en FCFA.' })
  soldeFapshi: number;

  @ApiProperty({ description: 'Vrai si Fapshi n’a pas répondu.' })
  obsolete: boolean;

  @ApiProperty({ description: 'Somme des poches des membres.' })
  totalPoches: number;

  @ApiProperty({
    description: 'Fapshi + poches : tout l’argent du bureau, où qu’il soit.',
  })
  totalFonds: number;

  @ApiProperty({
    description:
      'Retraits Fapshi dont on ne sait pas encore entre les mains de qui ils ' +
      'sont : de l’argent sorti de la plateforme et introuvable.',
  })
  nonAttribue: number;

  @ApiProperty({ description: 'Nombre de retraits non attribués.' })
  retraitsNonAttribues: number;

  @ApiProperty({
    description: 'Frais Fapshi payés sur les dépôts de membres, en FCFA.',
  })
  fraisDepots: number;

  @ApiProperty({ type: [PocheMembre] })
  poches: PocheMembre[];

  @ApiProperty({
    type: [String],
    description:
      'Anomalies à regarder : une poche négative, par exemple, veut dire ' +
      'qu’une remise a été déclarée sans que la réception le soit.',
  })
  alertes: string[];
}

export class ResultatMouvement {
  @ApiProperty({ type: 'object', additionalProperties: true })
  mouvement: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Dépôt sur la plateforme : page de paiement Fapshi où aller régler. Nul ' +
      'si le paiement est déjà confirmé.',
  })
  urlPaiement: string | null;
}
