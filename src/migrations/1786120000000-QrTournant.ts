import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Regime de controle a l'entree, par evenement.
 *
 * `QR_FIXE` par defaut, et c'est le point important : la valeur par defaut
 * decide du comportement de tous les evenements deja crees, qui emettent
 * aujourd'hui un billet par email. Prendre `AUCUN` comme defaut retirerait
 * silencieusement le controle a des evenements qui l'attendent ;
 * `QR_TOURNANT` priverait d'entree les inscrits qui n'ont que leur email.
 */
export class QrTournant1786120000000 implements MigrationInterface {
  name = 'QrTournant1786120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "evenements_controle_acces_enum"
      AS ENUM ('AUCUN', 'QR_FIXE', 'QR_TOURNANT')
    `);
    await queryRunner.query(`
      ALTER TABLE "evenements"
      ADD COLUMN "controle_acces" "evenements_controle_acces_enum"
      NOT NULL DEFAULT 'QR_FIXE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evenements" DROP COLUMN "controle_acces"
    `);
    await queryRunner.query(`DROP TYPE "evenements_controle_acces_enum"`);
  }
}
