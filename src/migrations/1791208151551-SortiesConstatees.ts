import { MigrationInterface, QueryRunner } from 'typeorm';

export class SortiesConstatees1791208151551 implements MigrationInterface {
  name = 'SortiesConstatees1791208151551';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "releves_solde" ADD "manque_depuis" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."retraits_source_enum" AS ENUM('FAPSHI', 'CONSTATEE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "retraits" ADD "source" "public"."retraits_source_enum" NOT NULL DEFAULT 'FAPSHI'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "retraits" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "public"."retraits_source_enum"`);
    await queryRunner.query(
      `ALTER TABLE "releves_solde" DROP COLUMN "manque_depuis"`,
    );
  }
}
