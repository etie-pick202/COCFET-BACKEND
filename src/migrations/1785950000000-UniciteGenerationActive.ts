import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Une seule génération active à la fois, garanti par la base.
 *
 * `isActive` est un simple booléen : rien n'empêchait deux générations
 * actives, ce qui rendait le thème, la tarification campus et le statut de
 * finissant indéterminés — la requête renvoyant l'une ou l'autre selon
 * l'ordre de lecture.
 *
 * L'index est **partiel** : il ne porte que sur les lignes actives. Un index
 * unique ordinaire sur `is_active` interdirait d'avoir deux générations
 * inactives, ce qui est le cas normal dès la deuxième année.
 *
 * Le contrôle vit en base et non seulement dans le service : une tâche, une
 * migration ou une correction manuelle en SQL contournerait le code, jamais
 * la contrainte.
 */
export class UniciteGenerationActive1785950000000 implements MigrationInterface {
  name = 'UniciteGenerationActive1785950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Filet de sécurité : si des données existantes violent déjà l'invariant,
    // la création de l'index échouerait. On ne conserve que la plus récente.
    await queryRunner.query(`
      UPDATE "generations" SET "is_active" = false
      WHERE "is_active" = true
        AND "id" <> (
          SELECT "id" FROM "generations"
          WHERE "is_active" = true
          ORDER BY "annee" DESC, "created_at" DESC
          LIMIT 1
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_generation_active"
      ON "generations" ("is_active") WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_generation_active"`);
  }
}
