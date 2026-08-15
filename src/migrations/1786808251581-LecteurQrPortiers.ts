import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le controle a l'entree, confie a des portiers.
 *
 * Valider un billet etait reserve a l'administration, ce qui obligeait a
 * confier les cles de la plateforme a quiconque tenait la porte.
 * « affectations_scanner » dissocie les deux : un portier valide les billets
 * d'un evenement precis sans rien administrer.
 *
 * L'affectation porte sur un evenement, jamais sur la plateforme entiere —
 * sans quoi un portier du gala validerait les billets de la conference du
 * lendemain. Aucune date d'expiration n'est stockee : elle cesse de valoir
 * quand la fenetre de validation s'est refermee, ce qui se calcule a la
 * lecture. Une date figee deriverait des qu'on decale l'evenement.
 *
 * « scanne_par_id » rattache un passage a son portier. « scanned_at » disait
 * quand, jamais par qui, et aucune verification a posteriori n'etait possible.
 */

export class LecteurQrPortiers1786808251581 implements MigrationInterface {
  name = 'LecteurQrPortiers1786808251581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "affectations_scanner" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "evenement_id" uuid NOT NULL, "user_id" uuid NOT NULL, "affecte_par_id" uuid, CONSTRAINT "uq_affectation_scanner" UNIQUE ("evenement_id", "user_id"), CONSTRAINT "PK_307d9ca30145e194de70926de07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "scanne_par_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD CONSTRAINT "FK_d3e86552c61d5021243c89fa171" FOREIGN KEY ("scanne_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" ADD CONSTRAINT "FK_4d82250fbc93903f2155c14b2dd" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" ADD CONSTRAINT "FK_d25bb6997b5dafbca461d09a69b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" ADD CONSTRAINT "FK_7a1b77c2de795796a90a9ad36b3" FOREIGN KEY ("affecte_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" DROP CONSTRAINT "FK_7a1b77c2de795796a90a9ad36b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" DROP CONSTRAINT "FK_d25bb6997b5dafbca461d09a69b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affectations_scanner" DROP CONSTRAINT "FK_4d82250fbc93903f2155c14b2dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP CONSTRAINT "FK_d3e86552c61d5021243c89fa171"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "scanne_par_id"`,
    );
    await queryRunner.query(`DROP TABLE "affectations_scanner"`);
  }
}
