import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facture du règlement d'une échéance de cotisation.
 *
 * Ajoute `FACTURE_COTISATION` aux types de documents. Les factures de
 * cotisation partagent le compteur des autres factures (`documents_facture_seq`)
 * : aucune nouvelle séquence, ni préfixe à part — « FAC » pour toutes.
 */
export class FactureCotisation1791300000000 implements MigrationInterface {
  name = 'FactureCotisation1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."documents_type_enum" ADD VALUE IF NOT EXISTS 'FACTURE_COTISATION'`,
    );
  }

  /**
   * PostgreSQL ne retire pas une valeur d'une énumération : on la recrée sans.
   * Les factures de cotisation sont supprimées d'abord — elles n'auraient plus
   * de type valide — puis la colonne est reconvertie.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "documents" WHERE "type" = 'FACTURE_COTISATION'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."documents_type_enum" RENAME TO "documents_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."documents_type_enum" AS ENUM('FACTURE_COMMANDE', 'RECU_BILLETTERIE', 'RAPPORT_TRESORERIE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ALTER COLUMN "type" TYPE "public"."documents_type_enum" USING "type"::"text"::"public"."documents_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."documents_type_enum_old"`);
  }
}
