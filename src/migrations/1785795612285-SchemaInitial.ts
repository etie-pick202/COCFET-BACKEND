import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaInitial1785795612285 implements MigrationInterface {
  name = 'SchemaInitial1785795612285';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('VISITOR', 'STUDENT', 'SPONSOR', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "email" character varying NOT NULL, "password_hash" character varying, "first_name" character varying NOT NULL, "last_name" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'VISITOR', "avatar" character varying, "promotion" character varying, "is_finissant" boolean NOT NULL DEFAULT false, "refresh_token_hash" character varying, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."produits_categorie_enum" AS ENUM('VETEMENT', 'GOODIES', 'ACCESSOIRE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."produits_statut_enum" AS ENUM('DISPONIBLE', 'PRECOMMANDE', 'RUPTURE', 'RETIRE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "produits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "nom" character varying NOT NULL, "description" text NOT NULL, "images" text, "prix_campus" integer NOT NULL DEFAULT '0', "prix_externe" integer NOT NULL DEFAULT '0', "categorie" "public"."produits_categorie_enum" NOT NULL DEFAULT 'GOODIES', "tailles" text, "couleurs" text, "stock" integer NOT NULL DEFAULT '0', "statut" "public"."produits_statut_enum" NOT NULL DEFAULT 'DISPONIBLE', "date_precommande" TIMESTAMP WITH TIME ZONE, "evenement_id" uuid, CONSTRAINT "PK_738095029a8d184b11939537702" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "generations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "annee" integer NOT NULL, "nom" character varying NOT NULL, "logo" character varying, "couleur_primaire" character varying NOT NULL DEFAULT '#000000', "couleur_secondaire" character varying NOT NULL DEFAULT '#FFFFFF', "is_active" boolean NOT NULL DEFAULT false, "archived_at" TIMESTAMP WITH TIME ZONE, "stats" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_9d2a52fbde1fba42c24ec42ddd2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_443927025e6b2db7e07bd289c0" ON "generations" ("annee") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."evenements_type_enum" AS ENUM('GRATUIT', 'PAYANT', 'SUR_INVITATION')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."evenements_statut_enum" AS ENUM('BROUILLON', 'PUBLIE', 'ARCHIVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "evenements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "titre" character varying NOT NULL, "description" text NOT NULL, "image_couverture" character varying, "date_debut" TIMESTAMP WITH TIME ZONE NOT NULL, "date_fin" TIMESTAMP WITH TIME ZONE, "lieu" character varying NOT NULL, "lieu_url" character varying, "type" "public"."evenements_type_enum" NOT NULL DEFAULT 'GRATUIT', "prix_campus" integer NOT NULL DEFAULT '0', "prix_externe" integer NOT NULL DEFAULT '0', "capacite_max" integer NOT NULL DEFAULT '0', "inscriptions_actuelles" integer NOT NULL DEFAULT '0', "statut" "public"."evenements_statut_enum" NOT NULL DEFAULT 'BROUILLON', "galerie" text, "recap" text, "generation_id" uuid, CONSTRAINT "PK_4d738e7c6ea49548ffbdbee5cdf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."paliers_sponsor_taille_logo_enum" AS ENUM('PETIT', 'MOYEN', 'GRAND')`,
    );
    await queryRunner.query(
      `CREATE TABLE "paliers_sponsor" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "nom" character varying NOT NULL, "ordre" integer NOT NULL DEFAULT '0', "acces_annuaire" boolean NOT NULL DEFAULT false, "max_consultations_profils" integer NOT NULL DEFAULT '0', "max_telechargements_cv" integer NOT NULL DEFAULT '0', "is_featured" boolean NOT NULL DEFAULT false, "taille_logo" "public"."paliers_sponsor_taille_logo_enum" NOT NULL DEFAULT 'MOYEN', "stats_detaillees" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_cfb1876e45387f7e88405629e31" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sponsors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "nom" character varying NOT NULL, "logo" character varying, "description" text, "site_web" character varying, "secteur" character varying, "email" character varying NOT NULL, "quotas_personnalises" jsonb, "stats" jsonb NOT NULL DEFAULT '{}', "user_id" uuid, "palier_id" uuid, CONSTRAINT "REL_fbc6d68d34dd7eab444f72b8f2" UNIQUE ("user_id"), CONSTRAINT "PK_6d1114fe7e65855154351b66bfc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sondages_type_enum" AS ENUM('CHOIX_UNIQUE', 'CHOIX_MULTIPLE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sondages_visibilite_resultats_enum" AS ENUM('TOUJOURS', 'APRES_VOTE', 'APRES_DEADLINE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sondages_statut_enum" AS ENUM('BROUILLON', 'ACTIF', 'CLOS')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sondages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "titre" character varying NOT NULL, "description" text, "type" "public"."sondages_type_enum" NOT NULL DEFAULT 'CHOIX_UNIQUE', "is_anonyme" boolean NOT NULL DEFAULT false, "deadline" TIMESTAMP WITH TIME ZONE NOT NULL, "visibilite_resultats" "public"."sondages_visibilite_resultats_enum" NOT NULL DEFAULT 'APRES_VOTE', "statut" "public"."sondages_statut_enum" NOT NULL DEFAULT 'BROUILLON', "total_votes" integer NOT NULL DEFAULT '0', "campus_uniquement" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_9b2b8e638588ebf77d25f8c747c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "options_sondage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "texte" text NOT NULL, "votes" integer NOT NULL DEFAULT '0', "sondage_id" uuid, CONSTRAINT "PK_094dfb28ce6d9e949b76804694f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "votes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "sondage_id" uuid, "user_id" uuid, CONSTRAINT "PK_f3d9fd4a0af865152c3f59db8ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ff4ba47c6ce2ade08855c589a2" ON "votes" ("sondage_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_origine_enum" AS ENUM('EVENEMENT', 'BOUTIQUE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_statut_enum" AS ENUM('EN_ATTENTE', 'COMPLETE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_methode_paiement_enum" AS ENUM('ORANGE_MONEY', 'MTN_MOMO')`,
    );
    await queryRunner.query(
      `CREATE TABLE "transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "origine" "public"."transactions_origine_enum" NOT NULL, "montant" integer NOT NULL, "statut" "public"."transactions_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE', "methode_paiement" "public"."transactions_methode_paiement_enum", "reference" character varying NOT NULL, "user_id" uuid, CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_dd85cc865e0c3d5d4be095d3f3" ON "transactions" ("reference") `,
    );
    await queryRunner.query(
      `CREATE TABLE "rappels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "date_rappel" TIMESTAMP WITH TIME ZONE NOT NULL, "canaux" text NOT NULL, "is_sent" boolean NOT NULL DEFAULT false, "user_id" uuid, "evenement_id" uuid, CONSTRAINT "PK_58101a3f44af9f042a3392504eb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('EVENEMENT', 'PAIEMENT', 'SONDAGE', 'ARTICLE', 'BOUTIQUE', 'RAPPEL', 'SYSTEME')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "type" "public"."notifications_type_enum" NOT NULL, "titre" character varying NOT NULL, "message" text NOT NULL, "lien" character varying, "is_read" boolean NOT NULL DEFAULT false, "user_id" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."commandes_statut_enum" AS ENUM('EN_ATTENTE', 'PAYEE', 'PRETE', 'RETIREE', 'ANNULEE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."commandes_methode_paiement_enum" AS ENUM('ORANGE_MONEY', 'MTN_MOMO')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."commandes_statut_paiement_enum" AS ENUM('EN_ATTENTE', 'COMPLETE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "commandes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "total" integer NOT NULL DEFAULT '0', "statut" "public"."commandes_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE', "methode_paiement" "public"."commandes_methode_paiement_enum", "statut_paiement" "public"."commandes_statut_paiement_enum" NOT NULL DEFAULT 'EN_ATTENTE', "facture_url" character varying, "telephone" character varying, "user_id" uuid, CONSTRAINT "PK_048c7aef9a99d4aed24c9054893" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "lignes_commande" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "quantite" integer NOT NULL DEFAULT '1', "taille" character varying, "couleur" character varying, "prix" integer NOT NULL, "commande_id" uuid, "produit_id" uuid, CONSTRAINT "PK_b075556ad91e84006a2fb6f32a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inscriptions_statut_enum" AS ENUM('EN_ATTENTE', 'CONFIRMEE', 'UTILISEE', 'ANNULEE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inscriptions_methode_paiement_enum" AS ENUM('ORANGE_MONEY', 'MTN_MOMO')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inscriptions_statut_paiement_enum" AS ENUM('EN_ATTENTE', 'COMPLETE', 'ECHOUE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "code_billet" character varying NOT NULL, "qr_code" text, "statut" "public"."inscriptions_statut_enum" NOT NULL DEFAULT 'EN_ATTENTE', "prix" integer NOT NULL DEFAULT '0', "methode_paiement" "public"."inscriptions_methode_paiement_enum", "statut_paiement" "public"."inscriptions_statut_paiement_enum" NOT NULL DEFAULT 'EN_ATTENTE', "scanned_at" TIMESTAMP WITH TIME ZONE, "user_id" uuid, "evenement_id" uuid, CONSTRAINT "PK_5443e2ee91338d76cac5de12f41" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_faafc4b1a706711bbce208a1ce" ON "inscriptions" ("code_billet") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."articles_statut_enum" AS ENUM('BROUILLON', 'PUBLIE', 'ARCHIVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "titre" character varying NOT NULL, "slug" character varying NOT NULL, "contenu" text NOT NULL, "extrait" text, "image_couverture" character varying, "categorie" character varying, "statut" "public"."articles_statut_enum" NOT NULL DEFAULT 'BROUILLON', "published_at" TIMESTAMP WITH TIME ZONE, "auteur_id" uuid, "evenement_id" uuid, CONSTRAINT "PK_0a6e2c450d83e0b6052c2793334" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_1123ff6815c5b8fec0ba9fec37" ON "articles" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "profils_finissants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "photo" character varying, "filiere" character varying NOT NULL, "promotion" character varying NOT NULL, "competences" text, "bio" text, "linkedin_url" character varying, "github_url" character varying, "portfolio_url" character varying, "cv_url" character varying, "is_visible" boolean NOT NULL DEFAULT true, "user_id" uuid, CONSTRAINT "REL_5223a1aace4ec542a20895be72" UNIQUE ("user_id"), CONSTRAINT "PK_5312d00ded890677ea1f743c305" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."journal_activite_type_enum" AS ENUM('INSCRIPTION', 'PAIEMENT', 'SCAN', 'VOTE', 'COMMANDE', 'ARTICLE', 'UTILISATEUR', 'EVENEMENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "journal_activite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "type" "public"."journal_activite_type_enum" NOT NULL, "message" text NOT NULL, "metadata" jsonb, "user_id" uuid, CONSTRAINT "PK_56c8ed6e4fe2636fa73fcb0e54f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "evenement_sponsors" ("evenement_id" uuid NOT NULL, "sponsor_id" uuid NOT NULL, CONSTRAINT "PK_20831c33907c8e2dcfa18cd1188" PRIMARY KEY ("evenement_id", "sponsor_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_406e2e10eed43e6db017400d27" ON "evenement_sponsors" ("evenement_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_357414174027fbfbef9796a331" ON "evenement_sponsors" ("sponsor_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "vote_options" ("vote_id" uuid NOT NULL, "option_id" uuid NOT NULL, CONSTRAINT "PK_c7941197a8679da5e546b9521d6" PRIMARY KEY ("vote_id", "option_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f40f400f3aa2581603739ecbe" ON "vote_options" ("vote_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d88b9a7651825154593cf5c35" ON "vote_options" ("option_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "produits" ADD CONSTRAINT "FK_726a2b73a86229cb9462c41211a" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenements" ADD CONSTRAINT "FK_1370d5476edb31745e3154121bf" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsors" ADD CONSTRAINT "FK_fbc6d68d34dd7eab444f72b8f24" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsors" ADD CONSTRAINT "FK_296cca34d5b10f8acad833b0718" FOREIGN KEY ("palier_id") REFERENCES "paliers_sponsor"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "options_sondage" ADD CONSTRAINT "FK_ef6b5ada7403701868112ab34bf" FOREIGN KEY ("sondage_id") REFERENCES "sondages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" ADD CONSTRAINT "FK_869ef56c29d8f2c0e4e87b3146c" FOREIGN KEY ("sondage_id") REFERENCES "sondages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" ADD CONSTRAINT "FK_27be2cab62274f6876ad6a31641" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_e9acc6efa76de013e8c1553ed2b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rappels" ADD CONSTRAINT "FK_5704fc15b3c90f2f8ff93969d18" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rappels" ADD CONSTRAINT "FK_9936b42981ef9a5056ba595f8a4" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" ADD CONSTRAINT "FK_f12e96abf962165bfd8e3df692b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lignes_commande" ADD CONSTRAINT "FK_e3e100f60db8e7230cca53ecb66" FOREIGN KEY ("commande_id") REFERENCES "commandes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lignes_commande" ADD CONSTRAINT "FK_a241db708e230fbe749ba5a8542" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD CONSTRAINT "FK_3b1a7085864c3bbd9df05855921" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD CONSTRAINT "FK_d5b9b5fccb7fb819fe46a3dbde1" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_038fc252a013b858eb77920c1e5" FOREIGN KEY ("auteur_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_e23b103577dba922051301f4494" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "profils_finissants" ADD CONSTRAINT "FK_5223a1aace4ec542a20895be728" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_activite" ADD CONSTRAINT "FK_da12d1b399b54cb97983413fdd3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenement_sponsors" ADD CONSTRAINT "FK_406e2e10eed43e6db017400d27b" FOREIGN KEY ("evenement_id") REFERENCES "evenements"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenement_sponsors" ADD CONSTRAINT "FK_357414174027fbfbef9796a331d" FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote_options" ADD CONSTRAINT "FK_3f40f400f3aa2581603739ecbe9" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote_options" ADD CONSTRAINT "FK_8d88b9a7651825154593cf5c35a" FOREIGN KEY ("option_id") REFERENCES "options_sondage"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vote_options" DROP CONSTRAINT "FK_8d88b9a7651825154593cf5c35a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vote_options" DROP CONSTRAINT "FK_3f40f400f3aa2581603739ecbe9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenement_sponsors" DROP CONSTRAINT "FK_357414174027fbfbef9796a331d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenement_sponsors" DROP CONSTRAINT "FK_406e2e10eed43e6db017400d27b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_activite" DROP CONSTRAINT "FK_da12d1b399b54cb97983413fdd3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profils_finissants" DROP CONSTRAINT "FK_5223a1aace4ec542a20895be728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_e23b103577dba922051301f4494"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_038fc252a013b858eb77920c1e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP CONSTRAINT "FK_d5b9b5fccb7fb819fe46a3dbde1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP CONSTRAINT "FK_3b1a7085864c3bbd9df05855921"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lignes_commande" DROP CONSTRAINT "FK_a241db708e230fbe749ba5a8542"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lignes_commande" DROP CONSTRAINT "FK_e3e100f60db8e7230cca53ecb66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" DROP CONSTRAINT "FK_f12e96abf962165bfd8e3df692b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rappels" DROP CONSTRAINT "FK_9936b42981ef9a5056ba595f8a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rappels" DROP CONSTRAINT "FK_5704fc15b3c90f2f8ff93969d18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_e9acc6efa76de013e8c1553ed2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" DROP CONSTRAINT "FK_27be2cab62274f6876ad6a31641"`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" DROP CONSTRAINT "FK_869ef56c29d8f2c0e4e87b3146c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "options_sondage" DROP CONSTRAINT "FK_ef6b5ada7403701868112ab34bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsors" DROP CONSTRAINT "FK_296cca34d5b10f8acad833b0718"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sponsors" DROP CONSTRAINT "FK_fbc6d68d34dd7eab444f72b8f24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evenements" DROP CONSTRAINT "FK_1370d5476edb31745e3154121bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "produits" DROP CONSTRAINT "FK_726a2b73a86229cb9462c41211a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d88b9a7651825154593cf5c35"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f40f400f3aa2581603739ecbe"`,
    );
    await queryRunner.query(`DROP TABLE "vote_options"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_357414174027fbfbef9796a331"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_406e2e10eed43e6db017400d27"`,
    );
    await queryRunner.query(`DROP TABLE "evenement_sponsors"`);
    await queryRunner.query(`DROP TABLE "journal_activite"`);
    await queryRunner.query(`DROP TYPE "public"."journal_activite_type_enum"`);
    await queryRunner.query(`DROP TABLE "profils_finissants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1123ff6815c5b8fec0ba9fec37"`,
    );
    await queryRunner.query(`DROP TABLE "articles"`);
    await queryRunner.query(`DROP TYPE "public"."articles_statut_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_faafc4b1a706711bbce208a1ce"`,
    );
    await queryRunner.query(`DROP TABLE "inscriptions"`);
    await queryRunner.query(
      `DROP TYPE "public"."inscriptions_statut_paiement_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."inscriptions_methode_paiement_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."inscriptions_statut_enum"`);
    await queryRunner.query(`DROP TABLE "lignes_commande"`);
    await queryRunner.query(`DROP TABLE "commandes"`);
    await queryRunner.query(
      `DROP TYPE "public"."commandes_statut_paiement_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."commandes_methode_paiement_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."commandes_statut_enum"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(`DROP TABLE "rappels"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd85cc865e0c3d5d4be095d3f3"`,
    );
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(
      `DROP TYPE "public"."transactions_methode_paiement_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."transactions_statut_enum"`);
    await queryRunner.query(`DROP TYPE "public"."transactions_origine_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff4ba47c6ce2ade08855c589a2"`,
    );
    await queryRunner.query(`DROP TABLE "votes"`);
    await queryRunner.query(`DROP TABLE "options_sondage"`);
    await queryRunner.query(`DROP TABLE "sondages"`);
    await queryRunner.query(`DROP TYPE "public"."sondages_statut_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."sondages_visibilite_resultats_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."sondages_type_enum"`);
    await queryRunner.query(`DROP TABLE "sponsors"`);
    await queryRunner.query(`DROP TABLE "paliers_sponsor"`);
    await queryRunner.query(
      `DROP TYPE "public"."paliers_sponsor_taille_logo_enum"`,
    );
    await queryRunner.query(`DROP TABLE "evenements"`);
    await queryRunner.query(`DROP TYPE "public"."evenements_statut_enum"`);
    await queryRunner.query(`DROP TYPE "public"."evenements_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_443927025e6b2db7e07bd289c0"`,
    );
    await queryRunner.query(`DROP TABLE "generations"`);
    await queryRunner.query(`DROP TABLE "produits"`);
    await queryRunner.query(`DROP TYPE "public"."produits_statut_enum"`);
    await queryRunner.query(`DROP TYPE "public"."produits_categorie_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
