import { MigrationInterface, QueryRunner } from 'typeorm';

export class CotiserPourUnAutre1793123895024 implements MigrationInterface {
  name = 'CotiserPourUnAutre1793123895024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" ADD "groupe_paiement" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" ADD "payeur_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff81113a51beff0dd44c29427b" ON "reglements_cotisation" ("groupe_paiement") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" ADD CONSTRAINT "FK_65cac5cddba3553b13c042ba091" FOREIGN KEY ("payeur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" DROP CONSTRAINT "FK_65cac5cddba3553b13c042ba091"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff81113a51beff0dd44c29427b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" DROP COLUMN "payeur_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" DROP COLUMN "groupe_paiement"`,
    );
  }
}
