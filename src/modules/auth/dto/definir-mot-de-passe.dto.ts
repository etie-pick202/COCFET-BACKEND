import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { EstUnMotDePasseValide } from './mot-de-passe';

/** Sert à la réinitialisation comme à l'activation d'une invitation sponsor. */
export class DefinirMotDePasseDto {
  @ApiProperty({ description: 'Jeton reçu par email.' })
  @IsString()
  @MaxLength(200)
  jeton: string;

  @EstUnMotDePasseValide()
  motDePasse: string;
}
