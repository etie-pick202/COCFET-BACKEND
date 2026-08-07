import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ReponseErreurDto } from './reponse-erreur.dto';

/**
 * Réponses d'erreur communes à toute route authentifiée.
 *
 * Appliqué une fois par contrôleur plutôt que répété sur chaque méthode : ces
 * trois codes valent partout, et les énumérer route par route noierait les
 * réponses vraiment spécifiques.
 */
export const ApiErreursAuthentification = () =>
  applyDecorators(
    ApiResponse({
      status: 401,
      description: 'Jeton absent, expiré ou invalide.',
      type: ReponseErreurDto,
    }),
    ApiResponse({
      status: 403,
      description: 'Droits insuffisants pour cette action.',
      type: ReponseErreurDto,
    }),
    ApiResponse({
      status: 429,
      description: 'Plafond de requêtes atteint.',
      type: ReponseErreurDto,
    }),
  );

/** Réponse de validation, sur toute route qui accepte un corps ou des filtres. */
export const ApiErreurValidation = () =>
  ApiResponse({
    status: 400,
    description: 'Données invalides — le détail par champ est dans « champs ».',
    type: ReponseErreurDto,
  });
