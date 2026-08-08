import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

export enum TypeJeton {
  /** Prouve la possession de la boîte, et débloque l'accès au compte. */
  VERIFICATION_EMAIL = 'VERIFICATION_EMAIL',
  /** Autorise la définition d'un nouveau mot de passe. */
  REINITIALISATION_MOT_DE_PASSE = 'REINITIALISATION_MOT_DE_PASSE',
  /** Créé par l'administration : vaut définition du mot de passe ET vérification. */
  INVITATION_SPONSOR = 'INVITATION_SPONSOR',
  /**
   * Confirme la possession d'une **nouvelle** adresse.
   *
   * Le lien part vers l'adresse demandée, jamais vers l'actuelle : c'est le
   * seul moyen de prouver que la personne y a bien accès avant d'en faire son
   * identifiant de connexion.
   */
  CHANGEMENT_EMAIL = 'CHANGEMENT_EMAIL',
}

/**
 * Jeton à usage unique envoyé par email.
 *
 * La valeur transmise à l'utilisateur n'est **jamais** stockée : seule son
 * empreinte l'est. Une fuite de la base ne permet donc pas de fabriquer un
 * lien valide, exactement comme pour un mot de passe.
 *
 * Les trois parcours partagent ce mécanisme plutôt que d'en réinventer un
 * chacun : c'est une surface d'attaque unique, donc une seule à sécuriser.
 */
@Entity('jetons_auth')
export class JetonAuth extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: TypeJeton })
  type: TypeJeton;

  /**
   * Empreinte SHA-256 du jeton. Indexée car c'est par elle qu'on retrouve la
   * ligne : le jeton en clair n'existe que dans l'email reçu.
   */
  @Index({ unique: true })
  @Column({ name: 'empreinte' })
  empreinte: string;

  @Column({ name: 'expire_le', type: 'timestamptz' })
  expireLe: Date;

  /**
   * Renseigné à la première utilisation. Un jeton consommé ne vaut plus rien,
   * même s'il n'a pas encore expiré : c'est ce qui rend l'usage unique.
   */
  @Column({ name: 'consomme_le', type: 'timestamptz', nullable: true })
  consommeLe: Date | null;
}
