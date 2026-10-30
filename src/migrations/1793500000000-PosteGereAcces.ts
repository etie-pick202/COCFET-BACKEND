import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Réserve à certains postes le droit de décider qui administre.
 *
 * Jusqu'ici, tout administrateur pouvait créer un poste doté de la trésorerie
 * et s'y nommer, ou nommer administrateur qui il voulait. Le droit est ouvert
 * d'office à la présidence (« Président(e) », pas la vice-présidence), seule
 * fonction dont c'est le rôle ; les autres postes devront être cochés
 * explicitement par elle.
 */
export class PosteGereAcces1793500000000 implements MigrationInterface {
  name = 'PosteGereAcces1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postes_bureau" ADD "gere_acces" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "postes_bureau" SET "gere_acces" = true WHERE "nom" ILIKE 'pr_sident%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postes_bureau" DROP COLUMN "gere_acces"`,
    );
  }
}
