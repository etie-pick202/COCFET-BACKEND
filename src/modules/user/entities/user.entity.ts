import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../../common/enums/role.enum';

@Entity('users')
export class User extends BaseEntity {
  /** Toujours stocké sous forme normalisée (voir `normaliserEmail`). */
  @Index({ unique: true })
  @Column()
  @ApiProperty({ example: 'etienne.mayack@2027.ucac-icam.com' })
  email: string;

  /**
   * Nul tant que le compte n'a pas de mot de passe : c'est le cas d'un sponsor
   * créé par l'administration, entre l'invitation et son activation. Un compte
   * dans cet état ne peut pas se connecter.
   */
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  @ApiHideProperty()
  passwordHash: string | null;

  @Column({ name: 'first_name' })
  @ApiProperty({ example: 'Etienne' })
  firstName: string;

  @Column({ name: 'last_name' })
  @ApiProperty({ example: 'Mayack' })
  lastName: string;

  @Column({ type: 'enum', enum: Role, default: Role.VISITOR })
  @ApiProperty({ enum: Role })
  role: Role;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({
    nullable: true,
    description: 'Clé de stockage — à échanger contre une URL signée.',
  })
  avatar: string | null;

  /**
   * Année de sortie déduite de l'adresse institutionnelle, jamais saisie.
   * Entier, pour être comparable directement à `Generation.annee`.
   */
  @Column({ type: 'int', nullable: true })
  @ApiProperty({ example: 2027, nullable: true })
  promotion: number | null;

  /**
   * Vrai si la promotion correspond à la génération active. Calculé, jamais
   * saisi, et recalculé au changement de génération.
   */
  @Column({ name: 'is_finissant', default: false })
  @ApiProperty()
  isFinissant: boolean;

  /**
   * Date de vérification de l'adresse. Tant qu'elle est nulle, la connexion
   * est refusée : recevoir le lien est la seule preuve que l'adresse
   * appartient bien à la personne qui s'inscrit.
   */
  @Column({ name: 'email_verifie_le', type: 'timestamptz', nullable: true })
  @ApiProperty({ format: 'date-time', nullable: true })
  emailVerifieLe: Date | null;

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  @ApiHideProperty()
  refreshTokenHash: string | null;

  /** Désactivation par l'administration, indépendante de la vérification. */
  @Column({ name: 'is_active', default: true })
  @ApiProperty()
  isActive: boolean;
}
