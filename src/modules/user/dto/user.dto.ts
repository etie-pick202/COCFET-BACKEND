import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum';
import { PaginationDto } from '../../../common/pagination';
import { EstUnMotDePasseValide } from '../../auth/dto/mot-de-passe';
import { User } from '../entities/user.entity';

/**
 * Ce qu'un utilisateur peut modifier chez lui.
 *
 * `role`, `promotion` et `isFinissant` en sont **absents et le resteront** :
 * le rôle ouvrirait l'administration à qui le demande, la promotion est
 * déduite de l'adresse institutionnelle et détermine le tarif campus, et le
 * statut de finissant décide de l'appartenance à l'annuaire consulté par les
 * entreprises. Aucun des trois ne se déclare — ils se calculent.
 *
 * L'adresse aussi est absente : la changer exigerait une nouvelle
 * vérification, et donc un parcours dédié plutôt qu'un champ de formulaire.
 */
export class MettreAJourProfilDto {
  @ApiPropertyOptional({ example: 'Etienne' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @IsOptional()
  prenom?: string;

  @ApiPropertyOptional({ example: 'Mayack' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @IsOptional()
  nom?: string;

  @ApiPropertyOptional({ description: 'Clé de l’objet dans le stockage.' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  avatar?: string;
}

export class ChangerMotDePasseDto {
  @ApiProperty({ description: 'Mot de passe actuel, exigé pour confirmer.' })
  @IsString()
  @MaxLength(200)
  motDePasseActuel: string;

  @EstUnMotDePasseValide()
  nouveauMotDePasse: string;
}

/** Réservé à l'administration. */
export class MettreAJourUtilisateurDto {
  @ApiPropertyOptional({ enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({
    description: 'Désactive le compte sans effacer son historique.',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Correction manuelle. Le marquage découle normalement de la génération active.',
  })
  @IsBoolean()
  @IsOptional()
  isFinissant?: boolean;
}

export class FiltreUtilisateurDto extends PaginationDto {
  @ApiPropertyOptional({ enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  promotion?: number;

  @ApiPropertyOptional()
  // Un paramètre de requête arrive en chaîne : sans cette transformation,
  // « false » serait vrai puisque toute chaîne non vide l'est.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  @IsOptional()
  isFinissant?: boolean;

  @ApiPropertyOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Recherche sur le nom et l’adresse.' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  recherche?: string;
}

/**
 * Vue d'un compte, sans aucun secret.
 *
 * Construite champ par champ plutôt qu'en retirant les secrets d'une entité :
 * une liste d'exclusion se laisse oublier au premier champ sensible ajouté,
 * alors qu'une liste d'inclusion oblige à décider pour chaque nouveau champ.
 */
export class UtilisateurExpose {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  email: string;

  @ApiProperty({ example: 'Etienne' })
  prenom: string;

  @ApiProperty({ example: 'Mayack' })
  nom: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({
    nullable: true,
    description: 'Clé de stockage — à échanger contre une URL signée.',
  })
  avatar: string | null;

  @ApiProperty({
    example: 2027,
    nullable: true,
    description: 'Déduite de l’adresse institutionnelle, jamais saisie.',
  })
  promotion: number | null;

  @ApiProperty({
    description:
      'Calculé à la bascule de génération. Conditionne l’appartenance à ' +
      'l’annuaire consulté par les entreprises.',
  })
  isFinissant: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  emailVerifie: boolean;

  @ApiProperty({
    description:
      'Faux pour un sponsor invité qui n’a pas encore activé son accès.',
  })
  aUnMotDePasse: boolean;

  @ApiProperty({ format: 'date-time' })
  creeLe: Date;
}

export function exposerUtilisateur(user: User): UtilisateurExpose {
  // `passwordHash` n'est plus chargé par défaut. Non chargé, il vaut
  // `undefined` et non `null` : le déduire donnerait « ce compte a un mot de
  // passe » sur un sponsor qui n'en a pas encore, ou l'inverse, sans que rien
  // ne le signale. On préfère échouer bruyamment que répondre au hasard.
  if ((user.passwordHash as string | null | undefined) === undefined) {
    throw new Error(
      'exposerUtilisateur a reçu un compte sans son empreinte : chargez-le ' +
        'via UserService.trouverOuEchouer, update ou lister.',
    );
  }

  return {
    id: user.id,
    email: user.email,
    prenom: user.firstName,
    nom: user.lastName,
    role: user.role,
    avatar: user.avatar,
    promotion: user.promotion,
    isFinissant: user.isFinissant,
    isActive: user.isActive,
    emailVerifie: user.emailVerifieLe !== null,
    aUnMotDePasse: user.passwordHash !== null,
    creeLe: user.createdAt,
  };
}
