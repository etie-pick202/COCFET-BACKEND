import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conserve l'identifiant de transaction du prestataire.
 *
 * La reconciliation interroge Fapshi par « GET /payment-status/:transId ». Cet
 * identifiant est renvoye a l'ouverture du paiement, mais n'etait pas
 * conserve : un webhook perdu laissait donc l'inscription en attente sans
 * qu'aucun code ne puisse trancher, la place bloquee et l'argent debite.
 *
 * Nullable a dessein : les transactions ouvertes avant cette colonne n'en ont
 * pas, et une valeur par defaut serait un identifiant faux — pire que rien,
 * puisqu'elle ferait interroger Fapshi sur une transaction inexistante.
 */
export class ReferenceExterneTransaction1786160000000 implements MigrationInterface {
  name = 'ReferenceExterneTransaction1786160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ADD COLUMN "reference_externe" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions" DROP COLUMN "reference_externe"
    `);
  }
}
