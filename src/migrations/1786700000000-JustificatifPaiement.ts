import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preuves de paiement remises hors de la plateforme.
 *
 * Tout le monde ne paie pas en ligne : on regle parfois le tresorier de la
 * main a la main. Sans ce chemin, ces reglements n'existent nulle part — la
 * place reste en attente et le journal de tresorerie ignore un argent pourtant
 * encaisse.
 *
 * La table ne connait ni commande ni inscription : elle porte une reference de
 * transaction et son origine, comme la notification d'un prestataire. C'est ce
 * qui lui permettra de servir aux cotisations sans changer de forme.
 *
 * « cle » est nullable des le depart : la purge des deux mois efface le
 * fichier et vide la colonne, en conservant la decision. Ce qui compte a long
 * terme est qu'un paiement a ete reconnu, par qui et quand — pas l'image.
 *
 * Le validateur part en « SET NULL » et non en « CASCADE » : le depart d'un
 * membre du bureau ne doit pas effacer les decisions qu'il a prises, sous
 * peine de laisser des paiements valides que plus personne n'assume.
 */
export class JustificatifPaiement1786700000000 implements MigrationInterface {
  name = 'JustificatifPaiement1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."justificatifs_paiement_statut_enum" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REFUSE')
    `);

    // Type propre a la table plutot que celui des transactions : TypeORM
    // nomme les siens « <table>_<colonne>_enum », et partager le type d'une
    // autre table ferait diverger le schema de ce que l'entite decrit.
    await queryRunner.query(`
      CREATE TYPE "public"."justificatifs_paiement_origine_enum" AS ENUM ('EVENEMENT', 'BOUTIQUE')
    `);

    await queryRunner.query(`
      CREATE TABLE "justificatifs_paiement" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "reference" character varying NOT NULL,
        "origine" "public"."justificatifs_paiement_origine_enum" NOT NULL,
        "cle" character varying,
        "montant_declare" integer NOT NULL,
        "statut" "public"."justificatifs_paiement_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE',
        "user_id" uuid NOT NULL,
        "validateur_id" uuid,
        "decide_le" TIMESTAMP WITH TIME ZONE,
        "motif_refus" character varying,
        CONSTRAINT "pk_justificatifs_paiement" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "justificatifs_paiement"
      ADD CONSTRAINT "fk_justificatif_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "justificatifs_paiement"
      ADD CONSTRAINT "fk_justificatif_validateur"
      FOREIGN KEY ("validateur_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // La tresorerie consulte les pieces d'un reglement precis, et filtre
    // l'historique par statut pour trouver ce qui attend une decision.
    await queryRunner.query(`
      CREATE INDEX "idx_justificatif_reference" ON "justificatifs_paiement" ("reference")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_justificatif_statut" ON "justificatifs_paiement" ("statut")
    `);

    // Un evenement n'accepte les captures que si son organisateur l'a voulu :
    // les ouvrir partout exposerait chaque inscription a une preuve fabriquee.
    await queryRunner.query(`
      ALTER TABLE "evenements"
      ADD COLUMN "accepte_justificatif" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evenements" DROP COLUMN "accepte_justificatif"
    `);
    await queryRunner.query(`DROP TABLE "justificatifs_paiement"`);
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_statut_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."justificatifs_paiement_origine_enum"`,
    );
  }
}
