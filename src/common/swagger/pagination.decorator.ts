import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { MetaPaginationDto } from './meta-pagination.dto';

/**
 * Décrit une réponse paginée dans le schéma OpenAPI.
 *
 * `ResultatPagine<T>` est générique : Swagger ne sait pas l'inférer, et la
 * réponse apparaîtrait vide. Ce décorateur reconstruit l'enveloppe à la main
 * autour du modèle transmis — c'est ce qui permet au frontend de générer un
 * client typé plutôt que de deviner la forme.
 */
export const ApiReponsePaginee = <T extends Type<unknown>>(
  modele: T,
  description?: string,
) =>
  applyDecorators(
    ApiExtraModels(MetaPaginationDto, modele),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['donnees', 'meta'],
        properties: {
          donnees: {
            type: 'array',
            items: { $ref: getSchemaPath(modele) },
          },
          meta: { $ref: getSchemaPath(MetaPaginationDto) },
        },
      },
    }),
  );
