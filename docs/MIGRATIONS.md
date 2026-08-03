# Migrations de base de données

Le schéma est géré **exclusivement par migrations**, y compris en développement. C'est la seule façon de garantir qu'une migration fonctionne avant de l'appliquer en production.

## Pourquoi pas `synchronize`

`synchronize: true` fait dériver le schéma directement des entités. C'est pratique au prototypage, mais **cette option supprime des colonnes lorsqu'un champ disparaît d'une entité** — donc des données. Elle ne laisse aucune trace, aucun retour arrière, aucune revue possible.

Elle reste disponible en développement via `DATABASE_SYNCHRONIZE=true`, pour du prototypage jetable. Elle est **inopérante hors développement**, quel que soit le contenu de la variable.

## Commandes

| Commande | Usage |
|---|---|
| `pnpm run migration:generate ./src/migrations/NomExplicite` | Génère une migration à partir de l'écart entre les entités et la base |
| `pnpm run migration:create ./src/migrations/NomExplicite` | Crée une migration vide, à écrire à la main |
| `pnpm run migration:run` | Applique les migrations en attente |
| `pnpm run migration:revert` | Annule la dernière migration appliquée |
| `pnpm run migration:show` | Liste les migrations et leur état |

## Modifier le schéma

1. Modifier l'entité.
2. `pnpm run migration:generate ./src/migrations/AjoutChampX` — la base doit être **à jour** avant, sinon la migration générée contiendra aussi les écarts antérieurs.
3. **Relire la migration générée.** TypeORM produit du SQL correct mais pas toujours souhaitable : un renommage de colonne est vu comme une suppression suivie d'un ajout, ce qui perd les données.
4. Vérifier que `down()` annule bien `up()` : `pnpm run migration:run` puis `pnpm run migration:revert`.
5. Commiter l'entité **et** sa migration dans la même PR.

> La CI refuse toute PR où une entité a été modifiée sans migration correspondante.

## Renommer une colonne sans perdre les données

Le cas mérite d'être traité à la main. TypeORM génère :

```sql
ALTER TABLE "x" DROP COLUMN "ancien";
ALTER TABLE "x" ADD "nouveau" character varying NOT NULL;
```

ce qui vide la colonne. Il faut remplacer par :

```sql
ALTER TABLE "x" RENAME COLUMN "ancien" TO "nouveau";
```

## Exécution selon l'environnement

| Environnement | Comportement |
|---|---|
| Développement | Migrations jouées au démarrage (`migrationsRun`) |
| Test / CI | Migrations jouées au démarrage |
| Production | **Jamais au démarrage.** Appliquées explicitement avant le basculement |

En production, jouer les migrations au démarrage exposerait à ce que plusieurs instances les appliquent simultanément, et à ce qu'un échec empêche tout démarrage. Elles sont donc lancées comme une étape distincte du déploiement, avant que le nouveau code ne reçoive du trafic.

## Deux sources de configuration

- `src/config/database.config.ts` — consommée par NestJS à l'exécution.
- `src/config/data-source.ts` — consommée par le **CLI TypeORM**, qui s'exécute hors du conteneur d'injection et ne peut donc pas résoudre `ConfigService`.

Les options TLS sont factorisées dans `src/config/tls.config.ts` : les migrations ne doivent jamais se connecter dans des conditions plus laxistes que l'application.

## Vérifications assurées par la CI

Le job **Migrations** valide, sur une base vierge, que :

1. Les migrations s'appliquent intégralement.
2. Le schéma obtenu **correspond exactement aux entités** — aucune dérive.
3. Le retour arrière ne laisse aucune table derrière lui.
