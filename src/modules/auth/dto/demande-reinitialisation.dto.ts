import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class DemandeReinitialisationDto {
  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  @IsEmail({}, { message: 'email doit être une adresse valide' })
  @MaxLength(254)
  email: string;
}
