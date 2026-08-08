import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

/** Fiche publiée dans l'annuaire, consultable par les sponsors accrédités. */
@Entity('profils_finissants')
export class ProfilFinissant extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Cle de stockage, jamais une URL : l'acces passe par une URL signee. */
  @Column({ type: 'varchar', nullable: true })
  photo: string | null;

  @Column()
  filiere: string;

  // La promotion n'est pas dupliquee ici : elle vit sur le compte, d'ou elle
  // est deduite de l'adresse institutionnelle. La stocker une seconde fois
  // creerait deux verites qui divergeraient au premier oubli d'ecriture.

  @Column({ type: 'jsonb', default: () => "'[]'" })
  competences: string[];

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'linkedin_url', type: 'varchar', nullable: true })
  linkedinUrl: string | null;

  @Column({ name: 'github_url', type: 'varchar', nullable: true })
  githubUrl: string | null;

  @Column({ name: 'portfolio_url', type: 'varchar', nullable: true })
  portfolioUrl: string | null;

  /**
   * Cle de stockage du CV.
   *
   * Jamais servie telle quelle : le CV est la donnee la plus sensible de
   * l'annuaire, et n'est accessible que par une URL signee expirante, apres
   * decompte du quota du sponsor demandeur.
   */
  @Column({ name: 'cv_url', type: 'varchar', nullable: true })
  cvUrl: string | null;

  /**
   * Presence dans l'annuaire, sous le controle **exclusif** de l'etudiant.
   *
   * Aucun endpoint d'administration ne la modifie : l'annuaire expose des
   * donnees personnelles a des entreprises, et le consentement de la personne
   * ne se delegue pas au bureau.
   */
  @Column({ name: 'is_visible', default: true })
  isVisible: boolean;
}
