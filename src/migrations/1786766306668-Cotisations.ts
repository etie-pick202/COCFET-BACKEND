import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Les cotisations : appeler une population a verser une somme, et en suivre le
 * solde.
 *
 * Une cotisation n'est pas un evenement — on n'y assiste pas, il n'y a pas de
 * place ni de billet — d'ou un domaine a part plutot qu'une billetterie
 * alourdie de regles qui ne la concernent pas.
 *
 * « participations_cotisation » porte le solde de chacun, et son identifiant
 * sert de reference de transaction : paiement en ligne, justificatif remis en
 * main propre, journal de tresorerie et reconciliation fonctionnent alors sans
 * une ligne de plus. « montant_du » y est recopie et non lu a travers la
 * cotisation : relever le montant rendrait sinon tout le monde retroactivement
 * en retard, y compris ceux qui avaient deja tout regle.
 *
 * « tranches_cotisation » jalonne le parcours sans decouper les paiements. Un
 * versement est un montant libre porte au solde ; les tranches sont ensuite
 * consommees dans l'ordre. C'est ce qui permet a la fois l'affichage attendu
 * et les cas que la vie impose : verser a cheval sur deux tranches, ou tout
 * regler d'un coup.
 *
 * « versements_finance » trace la remise au bureau de l'argent qu'un membre
 * detenait. Sans elle, le montant encaisse par quelqu'un ne ferait que croitre
 * et ne dirait plus combien il a en main aujourd'hui.
 *
 * Le justificatif gagne « montant_recu » — ce que la tresorerie reconnait, par
 * opposition a ce que le payeur declare — et « recu_par_id », qui n'est pas le
 * validateur : on remet l'argent au tresorier, et c'est peut-etre quelqu'un
 * d'autre qui valide la piece.
 */

export class Cotisations1786766306668 implements MigrationInterface {
  name = 'Cotisations1786766306668';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "versements_finance" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "montant" integer NOT NULL, "note" character varying, "membre_id" uuid NOT NULL, "recu_par_id" uuid, CONSTRAINT "PK_a70e699de177047b81b99fa796b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cotisations_statut_enum" AS ENUM('BROUILLON', 'OUVERTE', 'CLOSE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cotisations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "titre" character varying NOT NULL, "description" text, "montant_total" integer NOT NULL, "cibles" jsonb NOT NULL DEFAULT '[]', "statut" "public"."cotisations_statut_enum" NOT NULL DEFAULT 'BROUILLON', "date_limite" TIMESTAMP WITH TIME ZONE, "fractionnable" boolean NOT NULL DEFAULT false, "accepte_justificatif" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_172886b32b01d4328d3b2066797" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38db61da761c6c3c553a129943" ON "cotisations" ("statut") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tranches_cotisation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "ordre" integer NOT NULL, "libelle" character varying NOT NULL, "montant" integer NOT NULL, "date_limite" TIMESTAMP WITH TIME ZONE NOT NULL, "cotisation_id" uuid NOT NULL, CONSTRAINT "uq_tranche_cotisation_ordre" UNIQUE ("cotisation_id", "ordre"), CONSTRAINT "PK_a109ac86209ed58ae1dda52de4e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."participations_cotisation_statut_enum" AS ENUM('EN_COURS', 'SOLDEE', 'EXEMPTEE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "participations_cotisation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "montant_du" integer NOT NULL, "montant_regle" integer NOT NULL DEFAULT '0', "statut" "public"."participations_cotisation_statut_enum" NOT NULL DEFAULT 'EN_COURS', "cotisation_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "uq_participation_cotisation_user" UNIQUE ("cotisation_id", "user_id"), CONSTRAINT "PK_923b2183672dafdb2d3d1255384" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c1a0ac94f0a85c84a3efb6da7" ON "participations_cotisation" ("statut") `,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "montant_recu" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "recu_par_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum" RENAME TO "transactions_origine_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION')`,
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
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE', 'COTISATION')`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ALTER COLUMN "origine" TYPE "public"."justificatifs_paiement_origine_enum" USING "origine"::"text"::"public"."justificatifs_paiement_origine_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_origine_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD CONSTRAINT "FK_886222adb03feafbbb7cfef692d" FOREIGN KEY ("recu_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" ADD CONSTRAINT "FK_e157f8b28afe393b82ff7db8e51" FOREIGN KEY ("membre_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" ADD CONSTRAINT "FK_610f5f2aa6a87654a62c1414614" FOREIGN KEY ("recu_par_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tranches_cotisation" ADD CONSTRAINT "FK_76b39e8899761b8f7ec4d9e5bc3" FOREIGN KEY ("cotisation_id") REFERENCES "cotisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_cotisation" ADD CONSTRAINT "FK_483627214b322077c4712018247" FOREIGN KEY ("cotisation_id") REFERENCES "cotisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_cotisation" ADD CONSTRAINT "FK_375cfd0ef571cc5def1f3aea202" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "participations_cotisation" DROP CONSTRAINT "FK_375cfd0ef571cc5def1f3aea202"`,
    );
    await queryRunner.query(
      `ALTER TABLE "participations_cotisation" DROP CONSTRAINT "FK_483627214b322077c4712018247"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tranches_cotisation" DROP CONSTRAINT "FK_76b39e8899761b8f7ec4d9e5bc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" DROP CONSTRAINT "FK_610f5f2aa6a87654a62c1414614"`,
    );
    await queryRunner.query(
      `ALTER TABLE "versements_finance" DROP CONSTRAINT "FK_e157f8b28afe393b82ff7db8e51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP CONSTRAINT "FK_886222adb03feafbbb7cfef692d"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."justificatifs_paiement_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE')`,
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
      `CREATE TYPE "public"."transactions_origine_enum_old" AS ENUM('EVENEMENT', 'BOUTIQUE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "origine" TYPE "public"."transactions_origine_enum_old" USING "origine"::"text"::"public"."transactions_origine_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_origine_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."transactions_origine_enum_old" RENAME TO "transactions_origine_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "recu_par_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "montant_recu"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c1a0ac94f0a85c84a3efb6da7"`,
    );
    await queryRunner.query(`DROP TABLE "participations_cotisation"`);
    await queryRunner.query(
      `DROP TYPE "public"."participations_cotisation_statut_enum"`,
    );
    await queryRunner.query(`DROP TABLE "tranches_cotisation"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38db61da761c6c3c553a129943"`,
    );
    await queryRunner.query(`DROP TABLE "cotisations"`);
    await queryRunner.query(`DROP TYPE "public"."cotisations_statut_enum"`);
    await queryRunner.query(`DROP TABLE "versements_finance"`);
  }
}
