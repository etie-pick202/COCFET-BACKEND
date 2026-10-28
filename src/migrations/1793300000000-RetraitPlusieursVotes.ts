import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retire le réglage « plusieurs votes par personne », livré par erreur : ce
 * qu'on attend d'un sondage, c'est de choisir plusieurs options **en un seul
 * vote**, ce que le type `CHOIX_MULTIPLE` fait déjà.
 *
 * Les éventuels votes supplémentaires déposés pendant la brève période où le
 * réglage existait sont écartés, pour que l'unicité d'un vote par personne
 * puisse être rétablie : on garde le premier.
 */
export class RetraitPlusieursVotes1793300000000 implements MigrationInterface {
  name = 'RetraitPlusieursVotes1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "votes" v USING "votes" w
       WHERE v."user_id" IS NOT NULL
         AND v."sondage_id" = w."sondage_id" AND v."user_id" = w."user_id"
         AND (v."created_at", v."id") > (w."created_at", w."id")`,
    );
    await queryRunner.query(
      `DELETE FROM "participations_sondage" WHERE "rang" > 1`,
    );
    await queryRunner.query(
      `UPDATE "sondages" s SET "total_votes" = (
         SELECT COUNT(*) FROM "participations_sondage" p WHERE p."sondage_id" = s."id"
       ) WHERE s."plusieurs_votes" = true`,
    );
    await queryRunner.query(
      `UPDATE "options_sondage" o SET "votes" = (
         SELECT COUNT(*) FROM "vote_options" vo WHERE vo."option_id" = o."id"
       ) WHERE o."sondage_id" IN (SELECT "id" FROM "sondages" WHERE "plusieurs_votes" = true)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_participation_sondage_user_rang"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_participation_sondage_user" ON "participations_sondage" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff4ba47c6ce2ade08855c589a2"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ff4ba47c6ce2ade08855c589a2" ON "votes" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_sondage" DROP COLUMN "rang"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sondages" DROP COLUMN "plusieurs_votes"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sondages" ADD "plusieurs_votes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_sondage" ADD "rang" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff4ba47c6ce2ade08855c589a2"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff4ba47c6ce2ade08855c589a2" ON "votes" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_participation_sondage_user"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_participation_sondage_user_rang" ON "participations_sondage" ("sondage_id", "user_id", "rang") `,
    );
  }
}
