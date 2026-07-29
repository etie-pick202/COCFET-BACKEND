import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Experience } from '../../experience/entities/experience.entity';
import { Formation } from '../../formation/entities/formation.entity';
import { Promotion } from '../../promotion/entities/promotion.entity';
import { Skill } from '../../skills/entities/skill.entity';
import { User } from '../../user/entities/user.entity';

/** Profil finissant rattaché à un compte utilisateur. */
@Entity('etudiants')
export class Etudiant extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', nullable: true })
  filiere: string | null;

  @Column({ type: 'varchar', nullable: true })
  telephone: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'cv_key', type: 'varchar', nullable: true })
  cvKey: string | null;

  @Column({ name: 'photo_key', type: 'varchar', nullable: true })
  photoKey: string | null;

  @Column({ name: 'is_visible', default: true })
  isVisible: boolean;

  @ManyToOne(() => Promotion, (promotion) => promotion.etudiants, {
    nullable: true,
  })
  @JoinColumn({ name: 'promotion_id' })
  promotion: Promotion | null;

  @OneToMany(() => Experience, (experience) => experience.etudiant)
  experiences: Experience[];

  @OneToMany(() => Formation, (formation) => formation.etudiant)
  formations: Formation[];

  @ManyToMany(() => Skill, (skill) => skill.etudiants)
  @JoinTable({
    name: 'etudiant_skills',
    joinColumn: { name: 'etudiant_id' },
    inverseJoinColumn: { name: 'skill_id' },
  })
  skills: Skill[];
}
