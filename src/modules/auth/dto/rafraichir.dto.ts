import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RafraichirDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  refreshToken: string;
}
