import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

/** Fiche publiée dans l'annuaire, consultable par les sponsors accrédités. */
@Entity('profils_finissants')
export class ProfilFinissant extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', nullable: true })
  photo: string | null;

  @Column()
  filiere: string;

  @Column()
  promotion: string;

  @Column({ type: 'simple-array', nullable: true })
  competences: string[] | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'linkedin_url', type: 'varchar', nullable: true })
  linkedinUrl: string | null;

  @Column({ name: 'github_url', type: 'varchar', nullable: true })
  githubUrl: string | null;

  @Column({ name: 'portfolio_url', type: 'varchar', nullable: true })
  portfolioUrl: string | null;

  @Column({ name: 'cv_url', type: 'varchar', nullable: true })
  cvUrl: string | null;

  /** L'étudiant contrôle sa présence dans l'annuaire. */
  @Column({ name: 'is_visible', default: true })
  isVisible: boolean;
}
