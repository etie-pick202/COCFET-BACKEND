import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Solde réel du compte et ce qui l'explique.
 *
 * `ecart` est le chiffre à surveiller : solde chez Fapshi moins ce que nos
 * encaissements, diminués des retraits relevés, laissaient attendre. Proche de
 * zéro, tout s'explique. Négatif, de l'argent est sorti sans retrait relevé
 * (frais de retrait, prélèvement). Positif, de l'argent est entré sans passer
 * par l'application.
 */
export class EtatSolde {
  @ApiProperty({ description: 'Solde du compte chez Fapshi, en FCFA.' })
  soldeFapshi: number;

  @ApiProperty({ example: 'XAF' })
  devise: string;

  @ApiProperty({
    description:
      'Encaissé net par l’application (débité moins frais Fapshi), sur les ' +
      'seuls paiements passés par Fapshi.',
  })
  encaisseNet: number;

  @ApiProperty({
    description: 'Somme des retraits aboutis relevés chez Fapshi.',
  })
  retraitsReussis: number;

  @ApiProperty({
    description: 'Retraits demandés mais pas encore aboutis : déjà en route.',
  })
  retraitsEnCours: number;

  @ApiProperty({
    description:
      'Ce que le solde devrait valoir : encaissé net moins retraits ' +
      'aboutis et en cours.',
  })
  soldeAttendu: number;

  @ApiProperty({ description: 'Solde réel moins solde attendu.' })
  ecart: number;

  @ApiProperty({
    format: 'date-time',
    description: 'Dernière lecture réussie chez Fapshi.',
  })
  verifieLe: Date;

  @ApiProperty({
    description:
      'Vrai quand Fapshi n’a pas répondu : les chiffres sont ceux de la ' +
      'dernière lecture, pas ceux d’à l’instant.',
  })
  obsolete: boolean;
}

export class NoteRetraitDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: 'Motif de la sortie. Vide ou nul pour effacer.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string | null;
}
