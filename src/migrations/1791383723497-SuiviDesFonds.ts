import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suivi des fonds : où est l'argent, compte Fapshi d'un côté, poches des
 * membres de l'autre.
 *
 * - `mouvements_fonds` : le registre des remises (réception, transfert, dépôt
 *   sur la plateforme, remboursement, dépense) ;
 * - `retraits.detenteur_id` : le membre entre les mains de qui un retrait
 *   Fapshi a atterri ;
 * - `REMISE` ajoutée aux origines de transaction et de preuve : un dépôt de
 *   membre sur la plateforme passe par Fapshi sans être une recette ;
 * - `versements_finance` disparaît, remplacée par `mouvements_fonds`. Elle ne
 *   contenait aucune ligne en production : rien n'est à reprendre.
 */
export class SuiviDesFonds1791383723497 implements MigrationInterface {
  name = 'SuiviDesFonds1791383723497';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "versements_finance" DROP CONSTRAINT "FK_610f5f2aa6a87654a62c1414614"`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" DROP CONSTRAINT "FK_e157f8b28afe393b82ff7db8e51"`,
    );
    await queryRunner.query(`DROP TABLE "versements_finance"`);
    await queryRunner.query(
      `CREATE TYPE "public"."mouvements_fonds_type_enum" AS ENUM('RECEPTION', 'TRANSFERT', 'DEPOT_PLATEFORME', 'REMBOURSEMENT', 'DEPENSE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."mouvements_fonds_statut_enum" AS ENUM('EN_ATTENTE', 'VALIDE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "mouvements_fonds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "type" "public"."mouvements_fonds_type_enum" NOT NULL, "montant" integer NOT NULL, "beneficiaire" character varying, "origine" character varying, "note" character varying, "piece" character varying, "statut" "public"."mouvements_fonds_statut_enum" NOT NULL DEFAULT 'VALIDE', "reference" character varying, "frais_prestataire" integer NOT NULL DEFAULT '0', "url_paiement" character varying, "membre_id" uuid NOT NULL, "declare_par_id" uuid, "contrepartie_id" uuid, CONSTRAINT "PK_5bec169cd1d8db2483a9c1edc81" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ab9ea7488f59d7c072df0725d5" ON "mouvements_fonds" ("reference") WHERE "reference" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "retraits" ADD "detenteur_id" uuid`);
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum" RENAME TO "transactions_origine_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE')`,
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
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION', 'REMISE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ALTER COLUMN "origine" TYPE "public"."justificatifs_paiement_origine_enum" USING "origine"::"text"::"public"."justificatifs_paiement_origine_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_origine_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "retraits" ADD CONSTRAINT "FK_9147e8ec4e8c355d56b99481da9" FOREIGN KEY ("detenteur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" ADD CONSTRAINT "FK_c5885db7e4f3d259bbd74248ad6" FOREIGN KEY ("membre_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" ADD CONSTRAINT "FK_10e4609ce64248cc7f159d47802" FOREIGN KEY ("declare_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" ADD CONSTRAINT "FK_a379bff25e040a7a0c0c559db06" FOREIGN KEY ("contrepartie_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" DROP CONSTRAINT "FK_a379bff25e040a7a0c0c559db06"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" DROP CONSTRAINT "FK_10e4609ce64248cc7f159d47802"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mouvements_fonds" DROP CONSTRAINT "FK_c5885db7e4f3d259bbd74248ad6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "retraits" DROP CONSTRAINT "FK_9147e8ec4e8c355d56b99481da9"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION')`,
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
      `CREATE TYPE "public"."transactions_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "origine" TYPE "public"."transactions_origine_enum_old" USING "origine"::"text"::"public"."transactions_origine_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_origine_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum_old" RENAME TO "transactions_origine_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "retraits" DROP COLUMN "detenteur_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab9ea7488f59d7c072df0725d5"`,
    );
    await queryRunner.query(`DROP TABLE "mouvements_fonds"`);
    await queryRunner.query(
      `DROP TYPE "public"."mouvements_fonds_statut_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."mouvements_fonds_type_enum"`);
    await queryRunner.query(
      `CREATE TABLE "versements_finance" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "montant" integer NOT NULL, "note" character varying, "membre_id" uuid NOT NULL, "recu_par_id" uuid, CONSTRAINT "PK_a70e699de177047b81b99fa796b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" ADD CONSTRAINT "FK_e157f8b28afe393b82ff7db8e51" FOREIGN KEY ("membre_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" ADD CONSTRAINT "FK_610f5f2aa6a87654a62c1414614" FOREIGN KEY ("recu_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
