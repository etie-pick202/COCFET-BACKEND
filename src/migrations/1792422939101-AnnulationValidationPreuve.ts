import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnnulationValidationPreuve1792422939101 implements MigrationInterface {
  name = 'AnnulationValidationPreuve1792422939101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "validation_annulee_le" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "motif_annulation" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "annulations" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "validation_annulee_par_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD CONSTRAINT "FK_cc2bc22900ce3d69233fb0c179e" FOREIGN KEY ("validation_annulee_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP CONSTRAINT "FK_cc2bc22900ce3d69233fb0c179e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "validation_annulee_par_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "annulations"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "motif_annulation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "validation_annulee_le"`,
    );
  }
}
