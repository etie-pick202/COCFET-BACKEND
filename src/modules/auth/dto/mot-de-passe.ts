import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const LONGUEUR_MINIMALE = 12;
/**
 * bcrypt tronque silencieusement au-delà de 72 octets : refuser explicitement
 * vaut mieux que d'accepter un mot de passe dont seule une partie compte.
 */
export const LONGUEUR_MAXIMALE = 72;

/**
 * Politique de mot de passe.
 *
 * On privilégie la **longueur** aux règles de composition : « Motdepasse1! »
 * satisfait la plupart des exigences classiques tout en étant trivial à
 * deviner, alors qu'une phrase de passe longue résiste bien mieux. Une seule
 * contrainte de composition est conservée, pour écarter les suites triviales
 * du type « aaaaaaaaaaaa ».
 */
export function EstUnMotDePasseValide(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      minLength: LONGUEUR_MINIMALE,
      maxLength: LONGUEUR_MAXIMALE,
      description: `Au moins ${LONGUEUR_MINIMALE} caractères, dont au moins deux types différents (lettres, chiffres, symboles).`,
      example: 'phrase de passe longue 42',
    }),
    IsString(),
    MinLength(LONGUEUR_MINIMALE, {
      message: `motDePasse doit contenir au moins ${LONGUEUR_MINIMALE} caractères`,
    }),
    MaxLength(LONGUEUR_MAXIMALE, {
      message: `motDePasse ne peut pas dépasser ${LONGUEUR_MAXIMALE} caractères`,
    }),
    Matches(/^(?=.*[a-zA-Z])(?=.*[^a-zA-Z]).*$/, {
      message:
        'motDePasse doit mêler des lettres et au moins un chiffre ou symbole',
    }),
  );
}
