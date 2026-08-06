import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { EstUnEmail } from '../../../common/validation/email.decorator';
import { EstUnMotDePasseValide } from './mot-de-passe';

export class InscriptionDto {
  @EstUnEmail()
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
