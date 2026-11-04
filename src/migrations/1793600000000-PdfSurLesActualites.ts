import { MigrationInterface, QueryRunner } from 'typeorm';

/** Un PDF récapitulatif, feuilleté directement sur la page d'une actualité. */
export class PdfSurLesActualites1793600000000 implements MigrationInterface {
  name = 'PdfSurLesActualites1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "document_pdf" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "document_pdf"`,
    );
  }
}
