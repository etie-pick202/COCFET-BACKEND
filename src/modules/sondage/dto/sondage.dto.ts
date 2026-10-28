import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import { plainToInstance, Transform } from 'class-transformer';
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
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import {
  StatutSondage,
  TypeSondage,
  VisibiliteResultats,
} from '../entities/sondage.entity';

/** Au-delà, la liste devient illisible et le dépouillement sans intérêt. */
export const MAX_OPTIONS = 20;

/**
 * Une option à voter : un titre, et éventuellement une image.
 *
 * Le titre reste obligatoire même avec une image : il est ce que lit un lecteur
 * d'écran, ce qui s'affiche quand l'image tarde, et ce qui désigne le choix
 * dans le dépouillement.
 */
export class OptionSondageDto {
  @ApiProperty({ example: 'Afrofuturisme' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  texte: string;

  @ApiPropertyOptional({
    example: 'sondages/2027/6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e.png',
    description:
      'Clé renvoyée par POST /fichiers (usage « sondage »). Une clé du dossier ' +
      '« sondages/ » seulement : une autre ferait pointer l’option vers le CV ' +
      'ou le justificatif de quelqu’un.',
  })
  @IsString()
  @MaxLength(500)
  @Matches(/^sondages\/(?!.*\.\.)[\w\-./]+$/, {
    message: 'L’image doit être un fichier envoyé pour un sondage.',
  })
  @IsOptional()
  image?: string;
}

/**
 * Accepte l'ancienne forme (un simple texte) comme la nouvelle (un objet).
 *
 * Les clients déjà déployés envoient encore des chaînes : les refuser
 * casserait la création de sondage jusqu'à leur mise à jour.
 */
function normaliserOptions(options: unknown): unknown {
  if (!Array.isArray(options)) {
    return options;
  }
  return options.map((option: unknown) =>
    plainToInstance(
      OptionSondageDto,
      typeof option === 'string' ? { texte: option } : option,
    ),
  );
}

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
    type: [OptionSondageDto],
    example: [
      { texte: 'Années folles' },
      { texte: 'Afrofuturisme', image: 'sondages/2027/afrofuturisme.png' },
    ],
    description:
      'Deux options au minimum : un sondage à une seule réponse ne mesure rien. ' +
      'Chacune a un titre et peut avoir une image ; un simple texte reste accepté.',
  })
  @Transform(({ obj }: { obj: { options?: unknown } }) =>
    normaliserOptions(obj.options),
  )
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  // L'unicité des titres se vérifie dans le service, qui sait les comparer sans
  // tenir compte de la casse ni des espaces.
  options: OptionSondageDto[];

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
    default: false,
    description:
      'Vrai : une même personne peut voter plusieurs fois. Faux : un seul ' +
      'bulletin par personne, ce qu’attend un scrutin. Modifiable tant que ' +
      'le sondage est en brouillon.',
  })
  @IsBoolean()
  @IsOptional()
  plusieursVotes?: boolean;

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
    'plusieursVotes',
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

  @ApiProperty({
    nullable: true,
    description: 'Clé de l’image de l’option, nulle pour un texte seul.',
  })
  image: string | null;

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
