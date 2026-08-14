import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MembreBureau } from '../entities/membre-bureau.entity';

export class CreerPosteDto {
  @ApiProperty({ example: 'Président' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nom: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Ordre protocolaire. 1 = président.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  ordre?: number;

  @ApiPropertyOptional({
    description:
      'Poste sans lequel un mandat n’a pas de sens : une génération dont les ' +
      'postes clés ne sont pas pourvus ne peut pas être activée.',
  })
  @IsBoolean()
  @IsOptional()
  estCle?: boolean;

  @ApiPropertyOptional({
    description:
      'Le titulaire administre la plateforme. C’est par ce drapeau que la ' +
      'passation d’administration se fait à chaque changement de mandat.',
  })
  @IsBoolean()
  @IsOptional()
  accordeAdministration?: boolean;

  /**
   * Ces deux privilèges existaient déjà sur le poste, et les gardes les
   * appliquaient — mais aucun DTO ne les exposait. Ils n'étaient donc
   * réglables que par une écriture directe en base : personne ne pouvait
   * recevoir l'accès aux finances par l'API, et toute tentative se heurtait à
   * un 400.
   */
  @ApiPropertyOptional({
    description:
      'Le titulaire consulte les indicateurs financiers, le journal des ' +
      'transactions, l’export et le rapport de trésorerie. Distinct de ' +
      'l’administration : la personne qui publie les événements n’a pas à ' +
      'connaître les recettes.',
  })
  @IsBoolean()
  @IsOptional()
  accedeTresorerie?: boolean;

  @ApiPropertyOptional({
    description:
      'Le titulaire peut sortir de l’argent. **Volontairement distinct de ' +
      'l’accès à la trésorerie** : lire les comptes et les vider ne relèvent ' +
      'pas du même risque, et un commissaire aux comptes doit pouvoir tout ' +
      'consulter sans jamais pouvoir sortir un franc.',
  })
  @IsBoolean()
  @IsOptional()
  autoriseRetrait?: boolean;
}

export class MettreAJourPosteDto extends PartialType(CreerPosteDto) {}

export class AffecterMembreDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  posteId: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Doit être un compte étudiant de la promotion correspondant à cette ' +
      'génération : le COCFET est composé de finissants.',
  })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  presentation?: string;
}

export class MettreAJourMembreDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  presentation?: string;
}

export class DesignerLogoDto {
  @ApiProperty({
    description: 'Clé de stockage, parmi les logos déjà déposés.',
  })
  @IsString()
  @MaxLength(300)
  logo: string;
}

/** Vue publique d'un membre : ni adresse, ni identifiant de compte. */
export class MembrePublic {
  @ApiProperty({ example: 'Président' })
  poste: string;

  @ApiProperty({ example: 1, description: 'Ordre protocolaire d’affichage.' })
  ordre: number;

  @ApiProperty({ example: 'Awa' })
  prenom: string;

  @ApiProperty({ example: 'Ngassa' })
  nom: string;

  @ApiProperty({
    nullable: true,
    description: 'Clé de stockage — à échanger contre une URL signée.',
  })
  avatar: string | null;

  @ApiProperty({ nullable: true })
  presentation: string | null;
}

/**
 * Vue administrative d'un membre : le poste, le mandat, et le titulaire réduit
 * à sa vue exposée.
 *
 * Les routes d'administration renvoyaient l'entité `MembreBureau` telle quelle,
 * relation `user` comprise. `select: false` sur les empreintes suffit à ce
 * qu'elles n'y figurent plus ; cette projection ajoute la seconde barrière :
 * ce qui sort est ce qui est nommé ici, et rien d'autre ne peut s'y glisser
 * quand une colonne sera ajoutée à `User`.
 */
export class PosteDuMembre {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Président' })
  nom: string;

  @ApiProperty({ example: 1, description: 'Ordre protocolaire d’affichage.' })
  ordre: number;
}

/**
 * Le titulaire vu par l'administration : de quoi l'identifier et le
 * recontacter. Volontairement plus étroit que `UtilisateurExpose`, dont les
 * champs calculés — `aUnMotDePasse`, `emailVerifie` — relèvent de la gestion
 * des comptes et n'ont rien à faire dans la composition d'un bureau.
 */
export class TitulaireExpose {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  email: string;

  @ApiProperty({ example: 'Etienne' })
  prenom: string;

  @ApiProperty({ example: 'Mayack' })
  nom: string;

  @ApiProperty({
    nullable: true,
    description: 'Clé de stockage — à échanger contre une URL signée.',
  })
  avatar: string | null;

  @ApiProperty({ example: 2027, nullable: true })
  promotion: number | null;
}

export class MembreExpose {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: PosteDuMembre })
  poste: PosteDuMembre;

  @ApiProperty({ type: TitulaireExpose })
  membre: TitulaireExpose;

  @ApiProperty({ nullable: true })
  presentation: string | null;
}

export function exposerMembre(membre: MembreBureau): MembreExpose {
  return {
    id: membre.id,
    poste: {
      id: membre.poste.id,
      nom: membre.poste.nom,
      ordre: membre.poste.ordre,
    },
    membre: {
      id: membre.user.id,
      email: membre.user.email,
      prenom: membre.user.firstName,
      nom: membre.user.lastName,
      avatar: membre.user.avatar,
      promotion: membre.user.promotion,
    },
    presentation: membre.presentation,
  };
}

/** Ce que le frontend affiche sur la page « Le bureau ». */
export class BureauPublic {
  @ApiProperty({ example: 2027 })
  annee: number;

  @ApiProperty({ example: 'ATLAS', description: 'Nom du bureau.' })
  nom: string;

  @ApiProperty({
    nullable: true,
    description: 'Logo désigné pour la plateforme.',
  })
  logo: string | null;

  @ApiProperty({ example: '#0F172A' })
  couleurPrimaire: string;

  @ApiProperty({ example: '#D4AF37' })
  couleurSecondaire: string;

  @ApiProperty({ type: [MembrePublic] })
  membres: MembrePublic[];
}
