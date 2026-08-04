import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class VerifierEmailDto {
  @ApiProperty({ description: 'Jeton reçu par email.' })
  @IsString()
  @MaxLength(200)
  jeton: string;
}
