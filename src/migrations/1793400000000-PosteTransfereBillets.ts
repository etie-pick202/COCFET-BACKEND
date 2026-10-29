import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ouvre le transfert de billet à certains postes seulement.
 *
 * `false` par défaut, comme les privilèges de trésorerie : la valeur par
 * défaut décide du droit de tous les postes existants, et ouvrir d'office
 * laisserait tout le bureau changer le titulaire d'un billet. Chaque poste
 * devra être coché explicitement.
 */
export class PosteTransfereBillets1793400000000 implements MigrationInterface {
  name = 'PosteTransfereBillets1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postes_bureau" ADD "transfere_billets" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postes_bureau" DROP COLUMN "transfere_billets"`,
    );
  }
}
