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
   *
   * `select: false` : l'entité User est chargée en relation depuis le bureau,
   * les notifications, les billets et les fiches sponsor, et ces réponses la
   * sérialisent telle quelle. Sans cette option, l'empreinte part dans le JSON
   * à chaque fois — et il suffit d'une nouvelle relation `user` ajoutée
   * ailleurs pour rouvrir la fuite. La refermer ici la referme partout, y
   * compris pour le code qui n'est pas encore écrit. Les rares lectures qui en
   * ont besoin la redemandent explicitement (voir `UserService`).
   */
  @Column({
    name: 'password_hash',
    type: 'varchar',
    nullable: true,
    select: false,
  })
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

  /** Jamais chargée par défaut, pour la même raison que `passwordHash`. */
  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  refreshTokenHash: string | null;

  /** Désactivation par l'administration, indépendante de la vérification. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
