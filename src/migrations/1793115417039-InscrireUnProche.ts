import { MigrationInterface, QueryRunner } from 'typeorm';

export class InscrireUnProche1793115417039 implements MigrationInterface {
  name = 'InscrireUnProche1793115417039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "groupe_paiement" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "inscriptions" ADD "payeur_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_762762bc520ffb26803248ecfe" ON "inscriptions" ("groupe_paiement") `,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD CONSTRAINT "FK_734895f5f83578a2b5361193675" FOREIGN KEY ("payeur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP CONSTRAINT "FK_734895f5f83578a2b5361193675"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_762762bc520ffb26803248ecfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "payeur_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "groupe_paiement"`,
    );
  }
}
