import { Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Offre } from '../../offre/entities/offre.entity';
import { User } from '../../user/entities/user.entity';

/** Entreprise partenaire / sponsor, rattachée à un compte utilisateur. */
@Entity('companies')
export class Company extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  nom: string;

  @Column({ nullable: true })
  secteur: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'site_web', nullable: true })
  siteWeb: string | null;

  @Column({ name: 'logo_key', nullable: true })
  logoKey: string | null;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @OneToMany(() => Offre, (offre) => offre.company)
  offres: Offre[];
}
