import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptionsEvenement1792524899420 implements MigrationInterface {
  name = 'OptionsEvenement1792524899420';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "evenements" ADD "options" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenements" ADD "options_figees_avant_jours" integer NOT NULL DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "reponses" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "remis_le" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "remis_par_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD CONSTRAINT "FK_de467473c1e9111aee2b2425370" FOREIGN KEY ("remis_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP CONSTRAINT "FK_de467473c1e9111aee2b2425370"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "remis_par_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "remis_le"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "reponses"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenements" DROP COLUMN "options_figees_avant_jours"`,
    );
    await queryRunner.query(`ALTER TABLE "evenements" DROP COLUMN "options"`);
  }
}
