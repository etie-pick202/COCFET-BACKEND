import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../../common/enums/role.enum';

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column()
  email: string;

  /** Nul pour les comptes créés via le SSO UCAC-ICAM. */
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

  /** Promotion déduite de l'adresse email universitaire (ex. « 2027 »). */
  @Column({ type: 'varchar', nullable: true })
  promotion: string | null;

  /** Vrai si l'étudiant appartient à la promotion finissante en cours. */
  @Column({ name: 'is_finissant', default: false })
  isFinissant: boolean;

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
