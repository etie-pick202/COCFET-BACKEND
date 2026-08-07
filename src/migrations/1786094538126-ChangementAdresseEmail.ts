import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangementAdresseEmail1786094538126 implements MigrationInterface {
  name = 'ChangementAdresseEmail1786094538126';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_en_attente" character varying`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."jetons_auth_type_enum" RENAME TO "jetons_auth_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jetons_auth_type_enum" AS ENUM('VERIFICATION_EMAIL', 'REINITIALISATION_MOT_DE_PASSE', 'INVITATION_SPONSOR', 'CHANGEMENT_EMAIL')`,
    );
    await queryRunner.query(
      `ALTER TABLE "jetons_auth" ALTER COLUMN "type" TYPE "public"."jetons_auth_type_enum" USING "type"::"text"::"public"."jetons_auth_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."jetons_auth_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."jetons_auth_type_enum_old" AS ENUM('VERIFICATION_EMAIL', 'REINITIALISATION_MOT_DE_PASSE', 'INVITATION_SPONSOR')`,
    );
    await queryRunner.query(
      `ALTER TABLE "jetons_auth" ALTER COLUMN "type" TYPE "public"."jetons_auth_type_enum_old" USING "type"::"text"::"public"."jetons_auth_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."jetons_auth_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."jetons_auth_type_enum_old" RENAME TO "jetons_auth_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_en_attente"`,
    );
  }
}
