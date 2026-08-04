import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../../common/enums/role.enum';

@Entity('users')
export class User extends BaseEntity {
  /** Toujours stocké sous forme normalisée (voir `normaliserEmail`). */
  @Index({ unique: true })
  @Column()
  email: string;

  /**
   * Nul tant que le compte n'a pas de mot de passe : c'est le cas d'un sponsor
   * créé par l'administration, entre l'invitation et son activation. Un compte
   * dans cet état ne peut pas se connecter.
   */
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ type: 'enum', enum: Role, default: Role.VISITOR })
  role: Role;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  /**
   * Année de sortie déduite de l'adresse institutionnelle, jamais saisie.
   * Entier, pour être comparable directement à `Generation.annee`.
   */
  @Column({ type: 'int', nullable: true })
  promotion: number | null;

  /**
   * Vrai si la promotion correspond à la génération active. Calculé, jamais
   * saisi, et recalculé au changement de génération.
   */
  @Column({ name: 'is_finissant', default: false })
  isFinissant: boolean;

  /**
   * Date de vérification de l'adresse. Tant qu'elle est nulle, la connexion
   * est refusée : recevoir le lien est la seule preuve que l'adresse
   * appartient bien à la personne qui s'inscrit.
   */
  @Column({ name: 'email_verifie_le', type: 'timestamptz', nullable: true })
  emailVerifieLe: Date | null;

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null;

  /** Désactivation par l'administration, indépendante de la vérification. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
