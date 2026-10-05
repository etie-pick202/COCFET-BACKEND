import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoldeEtRetraitsFapshi1791196027044 implements MigrationInterface {
  name = 'SoldeEtRetraitsFapshi1791196027044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "releves_solde" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "solde_fapshi" integer NOT NULL, "devise" character varying NOT NULL DEFAULT 'XAF', "encaisse_net" integer NOT NULL, "retraits_reussis" integer NOT NULL, "verifie_le" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_12dd5e95798b87f5b20e4e28efc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."retraits_statut_enum" AS ENUM('EN_COURS', 'REUSSI', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "retraits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "reference_externe" character varying NOT NULL, "montant" integer NOT NULL, "statut" "public"."retraits_statut_enum" NOT NULL DEFAULT 'EN_COURS', "operateur" character varying, "beneficiaire" character varying, "motif" character varying, "reference_financiere" character varying, "initie_le" TIMESTAMP WITH TIME ZONE NOT NULL, "confirme_le" TIMESTAMP WITH TIME ZONE, "note" text, CONSTRAINT "PK_efcb1521274fdef79c0df6d7be5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_063e9e6b3477ececb69be5f856" ON "retraits" ("reference_externe") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_063e9e6b3477ececb69be5f856"`,
    );
    await queryRunner.query(`DROP TABLE "retraits"`);
    await queryRunner.query(`DROP TYPE "public"."retraits_statut_enum"`);
    await queryRunner.query(`DROP TABLE "releves_solde"`);
  }
}
