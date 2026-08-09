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

/**
 * Force la passerelle de paiement factice.
 *
 * Un `.env` de développeur porte désormais de vrais identifiants Fapshi — le
 * bac à sable se configure exactement comme la production, et c'est voulu. La
 * suite instancierait alors l'adaptateur réel : chaque inscription payante
 * partirait vers le prestataire, les tests dépendraient du réseau, et le
 * secret de webhook du développeur ferait échouer toutes les notifications
 * simulées. Les trois variables sont vidées pour que le double reprenne la
 * main, comme pour Upstash au-dessus.
 */
process.env.FAPSHI_API_USER = '';
process.env.FAPSHI_API_KEY = '';

/**
 * Secret connu des tests, qui simulent des notifications signées.
 *
 * Vidé plutôt que supprimé, la passerelle factice retomberait sur sa valeur
 * par défaut ; l'imposer ici rend la suite indépendante du poste sur lequel
 * elle tourne.
 */
process.env.FAPSHI_WEBHOOK_SECRET = 'secret-de-developpement';

/**
 * Force le stockage local.
 *
 * Un `.env` de developpeur porte de vrais identifiants R2 : la suite
 * televerserait alors dans le bucket du projet, et chaque execution y
 * laisserait des PDF de test. Sur un poste sans acces reseau au bucket, la
 * negociation TLS echoue et les documents ne sont plus ranges du tout — le
 * symptome ressemble a un bug de la retention alors qu'il s'agit d'un service
 * externe reellement sollicite. Les quatre variables sont videes pour que
 * l'adaptateur disque reprenne la main, comme pour Upstash et Fapshi.
 */
process.env.R2_ENDPOINT = '';
process.env.R2_BUCKET = '';
process.env.R2_ACCESS_KEY_ID = '';
process.env.R2_SECRET_ACCESS_KEY = '';
