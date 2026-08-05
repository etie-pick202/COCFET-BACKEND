import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { EstUnEmail } from '../../../common/validation/email.decorator';

export class ConnexionDto {
  @EstUnEmail()
  email: string;

  // Volontairement sans contrainte de robustesse : la politique s'applique à
  // la définition d'un mot de passe, pas à sa saisie. L'imposer ici révélerait
  // la politique en vigueur et gênerait les comptes plus anciens.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  motDePasse: string;
}
