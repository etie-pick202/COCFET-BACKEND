import { ApiProperty } from '@nestjs/swagger';

/**
 * Réponse d'accusé de réception, sans donnée exploitable.
 *
 * Utilisée là où l'API refuse de révéler l'issue réelle — inscription, envoi
 * d'un lien par email : le message est le même que l'adresse soit connue ou
 * non, et le frontend n'a rien d'autre à en tirer que l'affichage.
 */
export class ReponseMessageDto {
  @ApiProperty({
    example:
      "Si cette adresse peut être utilisée, un email vient d'y être envoyé.",
    description: 'Message destiné à l’affichage, en français.',
  })
  message: string;
}
