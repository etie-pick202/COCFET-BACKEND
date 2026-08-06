import { MigrationInterface, QueryRunner } from 'typeorm';

export class BureauCocfet1786026714218 implements MigrationInterface {
  name = 'BureauCocfet1786026714218';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "postes_bureau" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "nom" character varying NOT NULL, "description" text, "ordre" integer NOT NULL DEFAULT '0', "est_cle" boolean NOT NULL DEFAULT false, "accorde_administration" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_35ee318cb8eab6afa1e984fcdba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_aa7ccf8192a39c6df7c3728df7" ON "postes_bureau" ("nom") `,
    );
    await queryRunner.query(
      `CREATE TABLE "membres_bureau" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "presentation" text, "generation_id" uuid, "poste_id" uuid, "user_id" uuid, CONSTRAINT "uq_membre_generation_poste" UNIQUE ("generation_id", "poste_id"), CONSTRAINT "PK_82a5a8726b36c9bff64258814a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "generations" ADD "logos" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" ADD CONSTRAINT "FK_58d963cd59ea74182fbcf7885ee" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" ADD CONSTRAINT "FK_17e73c657b8da909ae9ff7e4811" FOREIGN KEY ("poste_id") REFERENCES "postes_bureau"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" ADD CONSTRAINT "FK_79df76a4b91e6aa4ed1589cbe34" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" DROP CONSTRAINT "FK_79df76a4b91e6aa4ed1589cbe34"`,
    );
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" DROP CONSTRAINT "FK_17e73c657b8da909ae9ff7e4811"`,
    );
    await queryRunner.query(
      `ALTER TABLE "membres_bureau" DROP CONSTRAINT "FK_58d963cd59ea74182fbcf7885ee"`,
    );
    await queryRunner.query(`ALTER TABLE "generations" DROP COLUMN "logos"`);
    await queryRunner.query(`DROP TABLE "membres_bureau"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa7ccf8192a39c6df7c3728df7"`,
    );
    await queryRunner.query(`DROP TABLE "postes_bureau"`);
  }
}
