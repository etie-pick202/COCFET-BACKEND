import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stock par taille et par couleur.
 *
 * Un compteur unique par produit ne dit pas ce que l'acheteur a besoin de
 * savoir. Un sweat affiche « 12 en stock » peut n'avoir plus aucun M : la
 * deception passe alors du catalogue a la commande, et le bureau decouvre le
 * probleme en preparant le retrait.
 *
 * « taille » et « couleur » sont nullables, ce qui permet a un produit sans
 * declinaison — un porte-cles — de vivre dans la meme table qu'un vetement.
 *
 * L'unicite porte sur le triplet : deux lignes pour « M / Noir » rendraient le
 * stock indetermine, et la reservation atomique choisirait au hasard laquelle
 * decrementer.
 *
 * Aucune donnee n'est reprise : les produits existants n'ont pas de
 * declinaison, et leur stock global continue de faire foi. Le detail ne prend
 * la main que sur les produits pour lesquels le bureau saisit une grille.
 */

export class DeclinaisonsProduit1786773757130 implements MigrationInterface {
  name = 'DeclinaisonsProduit1786773757130';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "declinaisons_produit" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "taille" character varying, "couleur" character varying, "stock" integer NOT NULL DEFAULT '0', "produit_id" uuid NOT NULL, CONSTRAINT "uq_declinaison_produit" UNIQUE ("produit_id", "taille", "couleur"), CONSTRAINT "PK_d4ded2d66ddb5456d0a15084e89" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "declinaisons_produit" ADD CONSTRAINT "FK_026cb70d27a593ef1679feebf22" FOREIGN KEY ("produit_id") REFERENCES "produits"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "declinaisons_produit" DROP CONSTRAINT "FK_026cb70d27a593ef1679feebf22"`,
    );
    await queryRunner.query(`DROP TABLE "declinaisons_produit"`);
  }
}
