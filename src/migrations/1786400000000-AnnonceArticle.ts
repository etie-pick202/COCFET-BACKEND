import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trace l'instant ou la parution d'un article a ete annoncee.
 *
 * La colonne est distincte de « published_at ». Un article programme porte sa
 * date de parution a l'avance, mais l'annonce ne part qu'une fois l'heure
 * venue : confondre les deux ferait renotifier le meme article a chaque
 * passage de la tache planifiee.
 *
 * Les articles deja parus recoivent leur date de parution comme date
 * d'annonce. Laisser la colonne nulle les ferait tous annoncer au premier
 * passage de la tache — la promotion recevrait d'un coup l'historique complet
 * des actualites.
 */
export class AnnonceArticle1786400000000 implements MigrationInterface {
  name = 'AnnonceArticle1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "articles"
      ADD COLUMN "annonce_le" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      UPDATE "articles"
         SET "annonce_le" = "published_at"
       WHERE "statut" = 'PUBLIE'
         AND "published_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "articles" DROP COLUMN "annonce_le"
    `);
  }
}
