import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rattache un sondage a l'evenement qu'il prepare.
 *
 * Choix du theme d'un gala, du menu, de la date d'une sortie : la consultation
 * porte sur un evenement precis, et le frontend doit pouvoir l'afficher a cote
 * de lui plutot que dans une liste separee ou personne ne va.
 *
 * « SET NULL » plutot que « CASCADE ». Supprimer un evenement ne doit pas
 * emporter la consultation qui l'a prepare : les voix exprimees restent une
 * decision du bureau, meme si l'evenement n'a finalement pas eu lieu.
 *
 * L'index accompagne le filtre « sondages de cet evenement », seule lecture
 * qui passe par cette colonne.
 */
export class SondageEvenement1786510000000 implements MigrationInterface {
  name = 'SondageEvenement1786510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sondages" ADD COLUMN "evenement_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "sondages"
        ADD CONSTRAINT "FK_sondage_evenement"
        FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sondage_evenement" ON "sondages" ("evenement_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sondage_evenement"`);
    await queryRunner.query(`
      ALTER TABLE "sondages" DROP CONSTRAINT "FK_sondage_evenement"
    `);
    await queryRunner.query(`
      ALTER TABLE "sondages" DROP COLUMN "evenement_id"
    `);
  }
}
