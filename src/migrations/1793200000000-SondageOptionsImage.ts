import { MigrationInterface, QueryRunner } from 'typeorm';

export class SondageOptionsImage1793200000000 implements MigrationInterface {
  name = 'SondageOptionsImage1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "options_sondage" ADD "image" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sondages" ADD "plusieurs_votes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_sondage" ADD "rang" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_participation_sondage_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff4ba47c6ce2ade08855c589a2"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff4ba47c6ce2ade08855c589a2" ON "votes" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_participation_sondage_user_rang" ON "participations_sondage" ("sondage_id", "user_id", "rang") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff4ba47c6ce2ade08855c589a2"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ff4ba47c6ce2ade08855c589a2" ON "votes" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_participation_sondage_user_rang"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_participation_sondage_user" ON "participations_sondage" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_sondage" DROP COLUMN "rang"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sondages" DROP COLUMN "plusieurs_votes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "options_sondage" DROP COLUMN "image"`,
    );
  }
}
