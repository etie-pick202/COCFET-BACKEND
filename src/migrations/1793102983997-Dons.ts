import { MigrationInterface, QueryRunner } from 'typeorm';

export class Dons1793102983997 implements MigrationInterface {
  name = 'Dons1793102983997';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."dons_type_donateur_enum" AS ENUM('PARTICULIER', 'ENTREPRISE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."dons_statut_enum" AS ENUM('EN_ATTENTE', 'COMPLETE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."dons_methode_paiement_enum" AS ENUM('ORANGE_MONEY', 'MTN_MOMO')`,
    );
    await queryRunner.query(
      `CREATE TABLE "dons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "reference" character varying NOT NULL, "montant" integer NOT NULL, "montant_debite" integer NOT NULL, "anonyme" boolean NOT NULL DEFAULT false, "type_donateur" "public"."dons_type_donateur_enum", "prenom" character varying, "nom" character varying, "raison_sociale" character varying, "contact" character varying, "email" character varying, "telephone_contact" character varying, "message" character varying(500), "statut" "public"."dons_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE', "methode_paiement" "public"."dons_methode_paiement_enum", "evenement_id" uuid, "user_id" uuid, CONSTRAINT "PK_07d2de7bfbdf8880196bc486f61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0e3f6a46333f309f61c113600a" ON "dons" ("reference") `,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum" RENAME TO "transactions_origine_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE', 'DON')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "origine" TYPE "public"."transactions_origine_enum" USING "origine"::"text"::"public"."transactions_origine_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."transactions_origine_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."justificatifs_paiement_origine_enum" RENAME TO "justificatifs_paiement_origine_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE', 'DON')`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ALTER COLUMN "origine" TYPE "public"."justificatifs_paiement_origine_enum" USING "origine"::"text"::"public"."justificatifs_paiement_origine_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_origine_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dons" ADD CONSTRAINT "FK_dac5af7abf694ab808d0ac5c261" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "dons" ADD CONSTRAINT "FK_e7c4e9d29dffca6b78983ca8487" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dons" DROP CONSTRAINT "FK_e7c4e9d29dffca6b78983ca8487"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dons" DROP CONSTRAINT "FK_dac5af7abf694ab808d0ac5c261"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ALTER COLUMN "origine" TYPE "public"."justificatifs_paiement_origine_enum_old" USING "origine"::"text"::"public"."justificatifs_paiement_origine_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_origine_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."justificatifs_paiement_origine_enum_old" RENAME TO "justificatifs_paiement_origine_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "origine" TYPE "public"."transactions_origine_enum_old" USING "origine"::"text"::"public"."transactions_origine_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_origine_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum_old" RENAME TO "transactions_origine_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e3f6a46333f309f61c113600a"`,
    );
    await queryRunner.query(`DROP TABLE "dons"`);
    await queryRunner.query(`DROP TYPE "public"."dons_methode_paiement_enum"`);
    await queryRunner.query(`DROP TYPE "public"."dons_statut_enum"`);
    await queryRunner.query(`DROP TYPE "public"."dons_type_donateur_enum"`);
  }
}
