import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import {
  StatutSondage,
  TypeSondage,
  VisibiliteResultats,
} from '../entities/sondage.entity';

/** Au-delà, la liste devient illisible et le dépouillement sans intérêt. */
export const MAX_OPTIONS = 20;

export class CreerSondageDto {
  @ApiProperty({ example: 'Quel thème pour le gala des finissants ?' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  titre: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: ['Années folles', 'Afrofuturisme', 'Black tie'],
    description:
      'Deux options au minimum : un sondage à une seule réponse ne mesure rien.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_OPTIONS)
  // Deux options identiques répartiraient les voix d'un même choix sur deux
  // lignes, et le dépouillement conclurait à l'inverse de l'intention.
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  options: string[];

  @ApiPropertyOptional({
    enum: TypeSondage,
    default: TypeSondage.CHOIX_UNIQUE,
  })
  @IsEnum(TypeSondage)
  @IsOptional()
  type?: TypeSondage;

  @ApiPropertyOptional({
    default: false,
    description:
      'Vrai : le bulletin n’est pas rattaché à son auteur. La participation ' +
      'reste enregistrée à part, ce qui interdit le double vote sans révéler ' +
      'le choix.',
  })
  @IsBoolean()
  @IsOptional()
  isAnonyme?: boolean;

  @ApiProperty({ example: '2027-07-01T23:59:00.000Z' })
  @IsDateString()
  deadline: string;

  @ApiPropertyOptional({
    enum: VisibiliteResultats,
    default: VisibiliteResultats.APRES_VOTE,
    description:
      'TOUJOURS : les résultats sont publics dès l’ouverture — au risque que ' +
      'les premiers votes orientent les suivants. APRES_VOTE : chacun les ' +
      'découvre après avoir voté. APRES_DEADLINE : personne avant la clôture.',
  })
  @IsEnum(VisibiliteResultats)
  @IsOptional()
  visibiliteResultats?: VisibiliteResultats;

  @ApiPropertyOptional({
    default: true,
    description:
      'Vrai : réservé aux membres du campus, reconnus à leur promotion. Un ' +
      'visiteur extérieur ne pèse pas sur une décision interne.',
  })
  @IsBoolean()
  @IsOptional()
  campusUniquement?: boolean;

  @ApiPropertyOptional({
    description:
      'Événement que le sondage prépare : thème d’un gala, menu, date d’une ' +
      'sortie. Permet de l’afficher à côté de l’événement plutôt que dans une ' +
      'liste séparée.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string;
}

/**
 * Ce qui reste modifiable, et rien de plus.
 *
 * Le titre, la question et les options disparaissent volontairement : une fois
 * le premier bulletin déposé, les changer ferait répondre les votants à une
 * question qu'ils n'ont pas lue. Tant que le sondage est en brouillon, il se
 * supprime et se recrée — c'est plus honnête qu'une réécriture silencieuse.
 */
export class MettreAJourSondageDto extends PartialType(
  PickType(CreerSondageDto, [
    'description',
    'deadline',
    'visibiliteResultats',
    'campusUniquement',
  ] as const),
) {
  /**
   * Redéclaré plutôt que repris du DTO de création, car il accepte ici `null`.
   *
   * `null` **détache** le sondage de son événement ; le champ absent le laisse
   * tel quel. Confondre les deux rendrait le détachement impossible : il n'y
   * aurait aucune façon d'exprimer « plus aucun événement ».
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'null détache le sondage de son événement.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string | null;
}

export class VoterDto {
  @ApiProperty({
    isArray: true,
    type: String,
    description:
      'Identifiants des options choisies. Exactement un pour un sondage à ' +
      'choix unique.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_OPTIONS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  optionIds: string[];
}

export class FiltreSondageDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: StatutSondage,
    description:
      'Réservé aux administrateurs. Le public ne voit ni les brouillons.',
  })
  @IsEnum(StatutSondage)
  @IsOptional()
  statut?: StatutSondage;

  @ApiPropertyOptional({
    description: 'true = uniquement les sondages encore ouverts au vote.',
  })
  // Un paramètre de requête arrive en chaîne : sans cette transformation,
  // « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  @IsOptional()
  ouverts?: boolean;

  @ApiPropertyOptional({
    description: 'Ne rend que les sondages rattachés à cet événement.',
  })
  @IsUUID()
  @IsOptional()
  evenementId?: string;
}

/** Une ligne de dépouillement. */
export class ResultatOption {
  @ApiProperty()
  id: string;

  @ApiProperty()
  texte: string;

  @ApiProperty({ description: 'Nul tant que les résultats sont masqués.' })
  votes: number | null;

  @ApiProperty({
    description:
      'Part des votants ayant retenu cette option. Sur un sondage à choix ' +
      'multiple, la somme des parts dépasse 100 %.',
    nullable: true,
  })
  pourcentage: number | null;
}

/** Ce que rend le dépouillement, adapté au demandeur. */
export class ResultatsSondage {
  @ApiProperty()
  sondageId: string;

  @ApiProperty({ description: 'Nombre de votants, non de choix exprimés.' })
  totalVotes: number;

  @ApiProperty({ description: 'Vrai si le demandeur a déjà voté.' })
  aVote: boolean;

  @ApiProperty({
    description:
      'Faux quand la visibilité du sondage masque encore le dépouillement : ' +
      'les décomptes sont alors nuls.',
  })
  resultatsVisibles: boolean;

  @ApiProperty({ type: [ResultatOption] })
  options: ResultatOption[];
}
