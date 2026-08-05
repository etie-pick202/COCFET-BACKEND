/**
 * Mise en place commune aux tests end-to-end.
 *
 * Exécuté avant le chargement de la configuration : les valeurs posées ici
 * l'emportent sur `.env`, que dotenv n'applique qu'aux variables absentes.
 */

/**
 * Neutralise la limitation de débit.
 *
 * Un `.env` de développeur peut porter de vrais identifiants Upstash. Le garde
 * devient alors actif pendant les tests : la suite dépasse largement les 100
 * requêtes par minute autorisées, et une poignée de tests échoue en 429 — pas
 * toujours les mêmes, selon celui qui franchit le seuil. Le symptôme ressemble
 * à un test instable alors qu'il s'agit d'un service externe réellement
 * sollicité, dont on consomme au passage le quota.
 */
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

/**
 * Coupe les tâches planifiées.
 *
 * Celle des rappels s'exécute à la minute : sur une suite qui dure plusieurs
 * minutes, elle se déclenche au milieu des tests et écrit des notifications
 * qu'aucun d'eux n'attend. Les services restent appelables directement, et
 * c'est ainsi qu'ils sont éprouvés.
 */
process.env.TACHES_PLANIFIEES = 'false';
