import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separe « qui a vote » de « ce qui a ete vote ».
 *
 * L'index unique (sondage, user) portait sur la table des bulletins. Il
 * n'avait donc aucun effet sur un sondage anonyme, dont les bulletins ont un
 * « user_id » nul : rien n'empechait la meme personne de voter cent fois.
 *
 * Garder le « user » sur le bulletin et se contenter de ne pas l'exposer
 * n'etait pas une option : le lien resterait en base, lisible depuis une
 * replique ou une sauvegarde, et un sondage sur la qualite du mandat cesserait
 * d'etre sincere. La participation est donc une table a part, nominative, sans
 * aucune relation vers le bulletin.
 *
 * Les votes deja enregistres sont reportes : sans cela, quiconque a deja vote
 * a un sondage nominatif pourrait voter une seconde fois.
 */
export class ParticipationSondage1786500000000 implements MigrationInterface {
  name = 'ParticipationSondage1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "participations_sondage" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "sondage_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "PK_participations_sondage" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_participation_sondage_user"
        ON "participations_sondage" ("sondage_id", "user_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "participations_sondage"
        ADD CONSTRAINT "FK_participation_sondage"
        FOREIGN KEY ("sondage_id") REFERENCES "sondages"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "participations_sondage"
        ADD CONSTRAINT "FK_participation_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Report des votes nominatifs deja enregistres. « DISTINCT » par prudence :
    // l'index unique sur les bulletins tolere plusieurs lignes a user nul, et
    // on ne veut pas faire echouer la migration sur un doublon historique.
    await queryRunner.query(`
      INSERT INTO "participations_sondage" ("sondage_id", "user_id")
      SELECT DISTINCT "sondage_id", "user_id"
        FROM "votes"
       WHERE "user_id" IS NOT NULL
         AND "sondage_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "participations_sondage"`);
  }
}
