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
export interface MembrePublic {
  poste: string;
  ordre: number;
  prenom: string;
  nom: string;
  avatar: string | null;
  presentation: string | null;
}

/** Ce que le frontend affiche sur la page « Le bureau ». */
export interface BureauPublic {
  annee: number;
  nom: string;
  logo: string | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
  membres: MembrePublic[];
}
