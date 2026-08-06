import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/** Limite du RFC 5321 pour une adresse complète. */
export const LONGUEUR_MAXIMALE_EMAIL = 254;

/**
 * Adresse email attendue en entrée d'API.
 *
 * L'espace de tête et de queue est retiré **avant** validation : une adresse
 * copiée depuis un client mail ou un tableur en traîne presque toujours un, et
 * refuser la saisie pour un caractère invisible produit un message d'erreur
 * incompréhensible. C'est aussi ce que fait `normaliserEmail` côté service —
 * les deux doivent s'accorder, sans quoi une adresse acceptable en base est
 * rejetée à la porte.
 */
export function EstUnEmail(exemple = 'prenom.nom@2027.ucac-icam.com') {
  return applyDecorators(
    ApiProperty({ example: exemple, maxLength: LONGUEUR_MAXIMALE_EMAIL }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsEmail({}, { message: 'email doit être une adresse valide' }),
    MaxLength(LONGUEUR_MAXIMALE_EMAIL),
  );
}
