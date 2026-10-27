import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination';
import {
  MethodePaiement,
  StatutPaiement,
} from '../../paiement/enums/paiement.enum';
import { TypeDonateur } from '../entities/don.entity';

/** Au-dessous, les frais mangeraient l'essentiel du don. */
export const DON_MINIMAL = 500;
export const DON_MAXIMAL = 10_000_000;

export enum DestinationDon {
  GENERAL = 'GENERAL',
  EVENEMENT = 'EVENEMENT',
}

const nettoyer = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreerDonDto {
  @ApiProperty({
    enum: DestinationDon,
    description:
      'Obligatoire, jamais devinée : un don au comité en général, ou pour un ' +
      'événement précis.',
  })
  @IsEnum(DestinationDon)
  destination: DestinationDon;

  @ApiPropertyOptional({
    description: 'Exigé quand la destination est un événement.',
  })
  @ValidateIf((o: CreerDonDto) => o.destination === DestinationDon.EVENEMENT)
  @IsUUID()
  evenementId?: string;

  @ApiProperty({
    description:
      'Vrai : aucune identité n’est conservée. Faux : le don est connu du comité.',
  })
  @IsBoolean()
  anonyme: boolean;

  @ApiPropertyOptional({ enum: TypeDonateur })
  @ValidateIf((o: CreerDonDto) => !o.anonyme)
  @IsEnum(TypeDonateur)
  typeDonateur?: TypeDonateur;

  @ApiPropertyOptional({ example: 'Aminata' })
  @ValidateIf(
    (o: CreerDonDto) =>
      !o.anonyme && o.typeDonateur === TypeDonateur.PARTICULIER,
  )
  @Transform(nettoyer)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  prenom?: string;

  @ApiPropertyOptional({ example: 'Nkoulou' })
  @ValidateIf(
    (o: CreerDonDto) =>
      !o.anonyme && o.typeDonateur === TypeDonateur.PARTICULIER,
  )
  @Transform(nettoyer)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nom?: string;

  @ApiPropertyOptional({ example: 'Brasseries du Cameroun' })
  @ValidateIf(
    (o: CreerDonDto) =>
      !o.anonyme && o.typeDonateur === TypeDonateur.ENTREPRISE,
  )
  @Transform(nettoyer)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  raisonSociale?: string;

  @ApiPropertyOptional({
    description: 'Personne à remercier, pour une entreprise.',
  })
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(120)
  contact?: string;

  @ApiPropertyOptional({
    description: 'Pour le remerciement. Exigé quand le don est connu.',
  })
  @ValidateIf((o: CreerDonDto) => !o.anonyme)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ example: '+237699000002' })
  @IsOptional()
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephoneContact doit être un numéro valide, ex. +237699000002',
  })
  telephoneContact?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(nettoyer)
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiProperty({
    example: 10000,
    description: `En FCFA, de ${DON_MINIMAL} à ${DON_MAXIMAL}.`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(DON_MINIMAL)
  @Max(DON_MAXIMAL)
  montant: number;

  @ApiPropertyOptional({
    enum: MethodePaiement,
    description:
      'Facultative. Sans elle, le donateur choisit son opérateur sur la page ' +
      'de paiement hébergée, et les frais sont calculés au taux le plus élevé.',
  })
  @IsEnum(MethodePaiement)
  @IsOptional()
  methodePaiement?: MethodePaiement;

  @ApiPropertyOptional({
    example: '+237699000002',
    description: 'Numéro Mobile Money.',
  })
  @Matches(/^\+?\d{8,15}$/, {
    message: 'telephone doit être un numéro valide, ex. +237699000002',
  })
  @IsOptional()
  telephone?: string;
}

export class FiltreDonDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Les dons pour cet événement.' })
  @IsUUID()
  @IsOptional()
  evenementId?: string;

  @ApiPropertyOptional({ description: 'Vrai : les dons au comité en général.' })
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  general?: boolean;

  @ApiPropertyOptional({
    enum: StatutPaiement,
    description: 'Par défaut : les dons reçus.',
  })
  @IsEnum(StatutPaiement)
  @IsOptional()
  statut?: StatutPaiement;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsDateString()
  @IsOptional()
  depuis?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsDateString()
  @IsOptional()
  jusqua?: string;
}
