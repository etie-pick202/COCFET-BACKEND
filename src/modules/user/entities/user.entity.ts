import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Role } from '../../../common/enums/role.enum';

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column()
  email: string;

  /** Nul pour les comptes créés via le SSO UCAC-ICAM. */
  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string | null;

  @Column({ name: 'first_name', nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'enum', enum: Role, default: Role.ETUDIANT })
  role: Role;

  @Column({ name: 'refresh_token_hash', nullable: true })
  refreshTokenHash: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
