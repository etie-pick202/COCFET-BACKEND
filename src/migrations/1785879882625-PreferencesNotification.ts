import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreferencesNotification1785879882625 implements MigrationInterface {
  name = 'PreferencesNotification1785879882625';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."preferences_notification_type_enum" AS ENUM('EVENEMENT', 'PAIEMENT', 'SONDAGE', 'ARTICLE', 'BOUTIQUE', 'RAPPEL', 'SYSTEME')`,
    );
    await queryRunner.query(
      `CREATE TABLE "preferences_notification" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "type" "public"."preferences_notification_type_enum" NOT NULL, "canal_email" boolean NOT NULL DEFAULT true, "canal_push" boolean NOT NULL DEFAULT true, "user_id" uuid, CONSTRAINT "uq_preference_user_type" UNIQUE ("user_id", "type"), CONSTRAINT "PK_d05b287ba5537ad84517798cdbd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ec8a36011976132bc425e6bdc3" ON "preferences_notification" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "preferences_notification" ADD CONSTRAINT "FK_ec8a36011976132bc425e6bdc38" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences_notification" DROP CONSTRAINT "FK_ec8a36011976132bc425e6bdc38"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec8a36011976132bc425e6bdc3"`,
    );
    await queryRunner.query(`DROP TABLE "preferences_notification"`);
    await queryRunner.query(
      `DROP TYPE "public"."preferences_notification_type_enum"`,
    );
  }
}
