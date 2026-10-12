import { MigrationInterface, QueryRunner } from 'typeorm';

export class ActualitesRiches1791799763789 implements MigrationInterface {
  name = 'ActualitesRiches1791799763789';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "commentaires_article" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "contenu" text NOT NULL, "masque" boolean NOT NULL DEFAULT false, "article_id" uuid NOT NULL, "auteur_id" uuid NOT NULL, CONSTRAINT "PK_537a8611c9de30008abc9026076" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1bafa8eb2f2683b8fec13546ff" ON "commentaires_article" ("article_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "couverture_video" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "vues" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."articles_audience_enum" AS ENUM('TOUS', 'FINISSANTS', 'PROMOTION', 'AUCUNE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "audience" "public"."articles_audience_enum" NOT NULL DEFAULT 'TOUS'`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "audience_promotion" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "commentaires_actifs" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "commentaires_article" ADD CONSTRAINT "FK_1bafa8eb2f2683b8fec13546ff4" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commentaires_article" ADD CONSTRAINT "FK_a94093f14e7950dc4f4f433dc34" FOREIGN KEY ("auteur_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commentaires_article" DROP CONSTRAINT "FK_a94093f14e7950dc4f4f433dc34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commentaires_article" DROP CONSTRAINT "FK_1bafa8eb2f2683b8fec13546ff4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "commentaires_actifs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "audience_promotion"`,
    );
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "audience"`);
    await queryRunner.query(`DROP TYPE "public"."articles_audience_enum"`);
    await queryRunner.query(`ALTER TABLE "articles" DROP COLUMN "vues"`);
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "couverture_video"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1bafa8eb2f2683b8fec13546ff"`,
    );
    await queryRunner.query(`DROP TABLE "commentaires_article"`);
  }
}
