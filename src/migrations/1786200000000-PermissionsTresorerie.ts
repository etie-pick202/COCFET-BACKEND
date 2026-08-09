import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ouvre la tresorerie a certains postes seulement.
 *
 * Les deux drapeaux sont portes par le **poste**, pas par la personne, comme
 * « accorde_administration » qui les precede. C'est ce qui fait survivre le
 * reglage a une passation : le poste de tresoriere garde ses droits quand son
 * titulaire change, et le catalogue reste une donnee que le bureau modifie
 * sans redeploiement.
 *
 * `false` par defaut, et c'est le point important : la valeur par defaut
 * decide du droit de tous les postes deja crees. Ouvrir par defaut donnerait
 * acces aux comptes a l'ensemble du bureau des la migration jouee — l'inverse
 * exact de ce qui est demande. Chaque poste devra etre coche explicitement.
 */
export class PermissionsTresorerie1786200000000 implements MigrationInterface {
  name = 'PermissionsTresorerie1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "postes_bureau"
      ADD COLUMN "accede_tresorerie" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "postes_bureau"
      ADD COLUMN "autorise_retrait" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "postes_bureau" DROP COLUMN "autorise_retrait"
    `);
    await queryRunner.query(`
      ALTER TABLE "postes_bureau" DROP COLUMN "accede_tresorerie"
    `);
  }
}
