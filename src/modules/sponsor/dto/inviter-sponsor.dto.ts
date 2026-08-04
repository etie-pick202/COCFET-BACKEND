import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EstUnEmail } from '../../../common/validation/email.decorator';

export class InviterSponsorDto {
  @ApiProperty({ example: 'Groupe Icam Cameroun' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  /** L'invitation y est envoyee, et elle servira ensuite d'identifiant. */
  @EstUnEmail('partenariats@entreprise.cm')
  email: string;

  @ApiPropertyOptional({ example: 'Ingénierie et formation' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  secteur?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://entreprise.cm' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(255)
  @IsOptional()
  siteWeb?: string;

  @ApiPropertyOptional({
    description:
      'Palier d’accréditation. Il détermine l’accès à l’annuaire et les quotas.',
  })
  @IsUUID()
  @IsOptional()
  palierId?: string;
}
