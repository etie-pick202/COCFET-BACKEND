import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Répercute les frais de paiement sur l'acheteur.
 *
 * « prix »/« total » ne bougent pas : ils restent le prix affiché. Trois
 * colonnes s'ajoutent, sur les inscriptions comme sur les commandes —
 * « frais_fapshi » et « frais_retrait » pour le détail, « montant_ttc » pour
 * ce qui est réellement transmis au prestataire de paiement. Voir
 * frais-paiement.ts pour le calcul.
 *
 * Nullables et sans donnée reprise : les lignes déjà réglées avant cette
 * fonctionnalité n'ont pas encaissé ces frais, les recalculer après coup ne
 * changerait rien à ce qui a réellement été payé.
 */
export class FraisPaiement1789587361757 implements MigrationInterface {
  name = 'FraisPaiement1789587361757';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "frais_fapshi" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "frais_retrait" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" ADD "montant_ttc" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" ADD "frais_fapshi" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" ADD "frais_retrait" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" ADD "montant_ttc" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commandes" DROP COLUMN "montant_ttc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" DROP COLUMN "frais_retrait"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commandes" DROP COLUMN "frais_fapshi"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "montant_ttc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "frais_retrait"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inscriptions" DROP COLUMN "frais_fapshi"`,
    );
  }
}
