import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Règlements de cotisation par échéance, et frais du prestataire au journal.
 *
 * 1. `reglements_cotisation` : chaque paiement d'une échéance — tranche ou
 *    totalité, en ligne ou par justificatif — porte désormais sa propre
 *    référence de transaction. Avant, cette référence était l'identifiant de
 *    la participation : une seule transaction possible par personne.
 * 2. `transactions.frais_prestataire` : la part que Fapshi retient sur le
 *    débité. Le rapport affichait le débité comme s'il était en caisse.
 * 3. `justificatifs_paiement.libelle` : ce que la pièce prétend régler, en
 *    clair, pour la trésorerie.
 *
 * **Reprise des frais déjà prélevés.** Les billets et commandes réglés en
 * ligne portent déjà leurs frais Fapshi (migration FraisPaiement) : ils sont
 * recopiés sur leur transaction, pour que les rapports sur une période passée
 * soient justes eux aussi. Un paiement reconnu sur justificatif n'est pas
 * passé par le prestataire : ses frais repassent à zéro, et son montant
 * devient celui que la trésorerie a certifié — comme le fait désormais la
 * validation.
 */
export class ReglementsCotisationEtFrais1791150228912 implements MigrationInterface {
  name = 'ReglementsCotisationEtFrais1791150228912';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."reglements_cotisation_mode_enum" AS ENUM('EN_LIGNE', 'JUSTIFICATIF')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reglements_cotisation_statut_enum" AS ENUM('EN_ATTENTE', 'COMPLETE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reglements_cotisation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "ordre_tranche" integer, "libelle" character varying NOT NULL, "montant" integer NOT NULL, "montant_debite" integer, "reference" character varying NOT NULL, "mode" "public"."reglements_cotisation_mode_enum" NOT NULL, "statut" "public"."reglements_cotisation_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE', "url_paiement" character varying, "participation_id" uuid NOT NULL, CONSTRAINT "PK_8ddba65bc428ddd89fdfcdc3d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b0e5fc42fa18d23a9ab154c247" ON "reglements_cotisation" ("reference") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7579de51db01886ffe2b62db01" ON "reglements_cotisation" ("statut") `,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "frais_prestataire" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" ADD "libelle" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" ADD CONSTRAINT "FK_0a980b654a7816b79341605778e" FOREIGN KEY ("participation_id") REFERENCES "participations_cotisation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Reprise : frais déjà prélevés sur les billets et commandes en ligne.
    await queryRunner.query(
      `UPDATE "transactions" t SET "frais_prestataire" = i."frais_fapshi"
       FROM "inscriptions" i
       WHERE t."origine" = 'EVENEMENT' AND t."reference" = i."code_billet"
         AND i."frais_fapshi" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "transactions" t SET "frais_prestataire" = c."frais_fapshi"
       FROM "commandes" c
       WHERE t."origine" = 'BOUTIQUE' AND t."reference" = c."id"::text
         AND c."frais_fapshi" IS NOT NULL`,
    );
    // Reprise : un paiement reconnu sur justificatif n'a rien versé au
    // prestataire, et vaut ce que la trésorerie a certifié.
    await queryRunner.query(
      `UPDATE "transactions" t
       SET "frais_prestataire" = 0, "montant" = j."montant_recu"
       FROM "justificatifs_paiement" j
       WHERE j."reference" = t."reference" AND j."statut" = 'VALIDE'
         AND j."montant_recu" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reglements_cotisation" DROP CONSTRAINT "FK_0a980b654a7816b79341605778e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "justificatifs_paiement" DROP COLUMN "libelle"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "frais_prestataire"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7579de51db01886ffe2b62db01"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0e5fc42fa18d23a9ab154c247"`,
    );
    await queryRunner.query(`DROP TABLE "reglements_cotisation"`);
    await queryRunner.query(
      `DROP TYPE "public"."reglements_cotisation_statut_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."reglements_cotisation_mode_enum"`,
    );
  }
}
