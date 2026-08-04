import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class ConnexionDto {
  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  @IsEmail({}, { message: 'email doit être une adresse valide' })
  @MaxLength(254)
  email: string;

  // Volontairement sans contrainte de robustesse : la politique s'applique à
  // la définition d'un mot de passe, pas à sa saisie. L'imposer ici révélerait
  // la politique en vigueur et gênerait les comptes plus anciens.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  motDePasse: string;
}
