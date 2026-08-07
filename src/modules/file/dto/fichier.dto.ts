import { ApiProperty } from '@nestjs/swagger';

/**
 * Ce que l'API rend après un téléversement.
 *
 * La clé est la seule chose à conserver : l'URL, elle, expire. Un frontend qui
 * l'enregistrerait en base afficherait une image morte dès le lendemain.
 */
export class FichierTeleverseDto {
  @ApiProperty({
    example: 'evenements/2027/6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e.png',
    description:
      'Clé de stockage, à conserver et à échanger contre une URL signée au ' +
      'moment de l’affichage.',
  })
  cle: string;

  @ApiProperty({
    description: 'URL de lecture temporaire, à ne jamais stocker.',
  })
  url: string;

  @ApiProperty({
    example: 'image/png',
    description:
      'Type déduit des premiers octets du fichier, pas de l’en-tête annoncé ' +
      'par le client.',
  })
  type: string;
}

/** URL de lecture temporaire, obtenue à partir d'une clé de stockage. */
export class UrlSigneeDto {
  @ApiProperty({ description: 'Expire — à redemander à chaque affichage.' })
  url: string;
}
