import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { EstUnMotDePasseValide } from './mot-de-passe';

export class InscriptionDto {
  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  @IsEmail({}, { message: 'email doit être une adresse valide' })
  @MaxLength(254)
  email: string;

  @EstUnMotDePasseValide()
  motDePasse: string;

  @ApiProperty({ example: 'Etienne' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  prenom: string;

  @ApiProperty({ example: 'Mayack' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nom: string;
}
