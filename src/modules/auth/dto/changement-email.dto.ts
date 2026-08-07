import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { EstUnEmail } from '../../../common/validation/email.decorator';

export class DemanderChangementEmailDto {
  /** La nouvelle adresse : c'est elle qui recevra le lien de confirmation. */
  @EstUnEmail('nouvelle.adresse@2027.ucac-icam.com')
  email: string;

  @ApiProperty({
    description:
      'Mot de passe actuel. Sans lui, un jeton volé suffirait à s’approprier ' +
      'le compte en basculant son identifiant de connexion.',
  })
  @IsString()
  @MaxLength(200)
  motDePasse: string;
}

export class ConfirmerChangementEmailDto {
  @ApiProperty({ description: 'Jeton reçu à la nouvelle adresse.' })
  @IsString()
  @MaxLength(200)
  jeton: string;
}
