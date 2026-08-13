import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conserve la page de paiement rendue par le prestataire.
 *
 * Quand le paiement passe par un lien heberge — le repli sur « initiate-pay »,
 * tant que « direct-pay » n'est pas active — le payeur doit ouvrir une page
 * pour regler. Cette page ne vivait que dans la reponse a la creation : qui
 * fermait l'onglet avant de payer n'avait plus aucun moyen de revenir a sa
 * commande, et devait l'annuler pour la refaire.
 *
 * Nullable, et vide en paiement direct : la demande part alors sur le
 * telephone du payeur, sans page intermediaire.
 *
 * La colonne est effacee des que le paiement est tranche. Un lien conserve
 * apres coup n'a plus d'usage, et laisser un moyen de payer une commande deja
 * reglee ou refusee ne peut produire qu'une confusion.
 */
export class UrlPaiement1786600000000 implements MigrationInterface {
  name = 'UrlPaiement1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "commandes" ADD COLUMN "url_paiement" character varying
    `);
    await queryRunner.query(`
      ALTER TABLE "inscriptions" ADD COLUMN "url_paiement" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inscriptions" DROP COLUMN "url_paiement"
    `);
    await queryRunner.query(`
      ALTER TABLE "commandes" DROP COLUMN "url_paiement"
    `);
  }
}
