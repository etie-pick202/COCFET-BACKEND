import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Table des pieces justificatives emises par la plateforme.
 *
 * `contenu` en jsonb porte tout ce qu'il faut pour redessiner le PDF. C'est
 * ce qui permet de purger les fichiers au-dela de trois mois sans perdre la
 * piece : elle se regenere a l'identique, meme si le produit a ete renomme et
 * le mandat remplace depuis.
 *
 * Trois sequences plutot qu'un COUNT(*) + 1 : deux emissions simultanees
 * recevraient le meme numero, et l'index unique en ferait echouer une au
 * moment precis ou la boutique est la plus sollicitee.
 *
 * L'unicite porte sur (type, source) : redemander la facture d'une commande
 * doit rendre la meme piece. Le rapport de tresorerie y echappe en portant
 * l'instant de son emission dans sa source, car deux rapports sur la meme
 * periode doivent pouvoir coexister.
 */
export class DocumentsJustificatifs1786300000000 implements MigrationInterface {
  name = 'DocumentsJustificatifs1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "documents_type_enum" AS ENUM (
        'FACTURE_COMMANDE', 'RECU_BILLETTERIE', 'RAPPORT_TRESORERIE'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "type" "documents_type_enum" NOT NULL,
        "numero" character varying NOT NULL,
        "user_id" uuid,
        "titre" character varying NOT NULL,
        "montant" integer NOT NULL DEFAULT 0,
        "source" character varying NOT NULL,
        "contenu" jsonb NOT NULL,
        "cle" character varying,
        "purge_le" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_documents" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "documents"
      ADD CONSTRAINT "FK_c7481daf5059307842edef74d73"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_documents_numero" ON "documents" ("numero")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_documents_type_source"
      ON "documents" ("type", "source")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_documents_type" ON "documents" ("type")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_documents_source" ON "documents" ("source")
    `);
    // La purge balaie les fichiers encore presents et assez anciens : sans cet
    // index, la tache nocturne parcourrait toute la table chaque nuit.
    await queryRunner.query(`
      CREATE INDEX "IDX_documents_purge"
      ON "documents" ("created_at") WHERE "cle" IS NOT NULL
    `);

    await queryRunner.query(`CREATE SEQUENCE "documents_facture_seq" START 1`);
    await queryRunner.query(`CREATE SEQUENCE "documents_recu_seq" START 1`);
    await queryRunner.query(`CREATE SEQUENCE "documents_rapport_seq" START 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "documents_rapport_seq"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "documents_recu_seq"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "documents_facture_seq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "documents_type_enum"`);
  }
}
