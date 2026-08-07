import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Forme unique de toutes les erreurs de l'API.
 *
 * Décrite ici en classe — et non seulement en interface — pour que Swagger
 * l'émette dans le schéma : le frontend doit pouvoir écrire son gestionnaire
 * d'erreurs une fois, à partir du contrat, plutôt qu'en observant les
 * réponses au cas par cas.
 */
export class ReponseErreurDto {
  @ApiProperty({
    example: 'VALIDATION',
    description:
      'Code stable, destiné au code appelant. Contrairement au message, il ne ' +
      'change pas quand la formulation évolue.',
  })
  code: string;

  @ApiProperty({
    example: 'Les données envoyées sont invalides.',
    description: 'Message destiné à l’affichage, en français.',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Erreurs de validation regroupées par champ. Présent uniquement sur un 400.',
    example: { email: ['email doit être une adresse valide'] },
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  champs?: Record<string, string[]>;

  @ApiProperty({ example: '2027-08-12T18:00:00.000Z' })
  horodatage: string;

  @ApiProperty({ example: '/api/v1/auth/connexion' })
  chemin: string;

  @ApiProperty({
    example: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
    description:
      'Identifiant à communiquer au support : il permet de retrouver la trace ' +
      'complète de l’erreur dans les journaux, sans que celle-ci soit exposée.',
  })
  identifiantCorrelation: string;
}
