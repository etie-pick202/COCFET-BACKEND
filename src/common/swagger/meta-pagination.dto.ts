import { ApiProperty } from '@nestjs/swagger';

/** Métadonnées accompagnant toute liste paginée. */
export class MetaPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20, description: 'Plafonnée à 100.' })
  limite: number;

  @ApiProperty({ example: 137, description: 'Total avant pagination.' })
  total: number;

  @ApiProperty({ example: 7 })
  totalPages: number;

  @ApiProperty({
    example: true,
    description:
      'Comparé au total, jamais à la taille de la page : une dernière page ' +
      'pleine ne signifie pas qu’une suivante existe.',
  })
  aSuivante: boolean;

  @ApiProperty({ example: false })
  aPrecedente: boolean;
}
