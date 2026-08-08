import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligne la fiche d'annuaire sur le modele reel.
 *
 * `promotion` disparait : elle vit deja sur le compte, ou elle est deduite de
 * l'adresse institutionnelle. La stocker une seconde fois creerait deux
 * verites qui divergeraient au premier oubli d'ecriture — et c'est cette
 * colonne-la qui deciderait de la promotion affichee aux entreprises.
 *
 * `competences` passe de simple-array a jsonb, pour permettre la recherche par
 * contenance (`@>`) : un profil doit posseder **toutes** les competences
 * demandees. Sur du texte separe par des virgules, il faudrait des LIKE
 * successifs, qui trouveraient « java » dans « javascript ».
 */
export class AnnuaireFinissants1786029814377 implements MigrationInterface {
  name = 'AnnuaireFinissants1786029814377';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Conversion et non suppression-recreation : la seconde effacerait les
    // competences deja saisies. La table est vide aujourd'hui, mais une
    // migration se rejoue aussi sur des bases qui ne le sont pas.
    await queryRunner.query(`
      ALTER TABLE "profils_finissants"
      ALTER COLUMN "competences" TYPE jsonb
      USING COALESCE(to_jsonb(string_to_array("competences", ',')), '[]'::jsonb)
    `);
    await queryRunner.query(`
      ALTER TABLE "profils_finissants"
      ALTER COLUMN "competences" SET DEFAULT '[]',
      ALTER COLUMN "competences" SET NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "profils_finissants" DROP COLUMN "promotion"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profils_finissants" ADD "promotion" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(`
      ALTER TABLE "profils_finissants"
      ALTER COLUMN "competences" DROP NOT NULL,
      ALTER COLUMN "competences" DROP DEFAULT
    `);
    // Expression scalaire, sans sous-requete : PostgreSQL refuse toute
    // sous-requete dans un USING de transformation. On repasse par la
    // representation textuelle du jsonb, dont on retire crochets et guillemets.
    await queryRunner.query(`
      ALTER TABLE "profils_finissants"
      ALTER COLUMN "competences" TYPE text
      USING replace(translate("competences"::text, '[]"', ''), ', ', ',')
    `);
  }
}
