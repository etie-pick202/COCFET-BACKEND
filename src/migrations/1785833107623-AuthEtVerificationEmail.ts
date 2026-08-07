import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthEtVerificationEmail1785833107623 implements MigrationInterface {
  name = 'AuthEtVerificationEmail1785833107623';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."jetons_auth_type_enum" AS ENUM('VERIFICATION_EMAIL', 'REINITIALISATION_MOT_DE_PASSE', 'INVITATION_SPONSOR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "jetons_auth" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "type" "public"."jetons_auth_type_enum" NOT NULL, "empreinte" character varying NOT NULL, "expire_le" TIMESTAMP WITH TIME ZONE NOT NULL, "consomme_le" TIMESTAMP WITH TIME ZONE, "user_id" uuid NOT NULL, CONSTRAINT "PK_87c34fe64dee3fc3f9d250e74bd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ac4daa7addd75c5f10c3224c8b" ON "jetons_auth" ("empreinte") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verifie_le" TIMESTAMP WITH TIME ZONE`,
    );
    // Conversion sur place plutôt que DROP puis ADD, qui viderait la colonne.
    // Voir docs/MIGRATIONS.md : TypeORM génère systématiquement la forme
    // destructrice pour un changement de type.
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "promotion" TYPE integer USING NULLIF("promotion", '')::integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "jetons_auth" ADD CONSTRAINT "FK_0e7e85b7d0995ddce8f4e04d49a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jetons_auth" DROP CONSTRAINT "FK_0e7e85b7d0995ddce8f4e04d49a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "promotion" TYPE character varying USING "promotion"::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verifie_le"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac4daa7addd75c5f10c3224c8b"`,
    );
    await queryRunner.query(`DROP TABLE "jetons_auth"`);
    await queryRunner.query(`DROP TYPE "public"."jetons_auth_type_enum"`);
  }
}
