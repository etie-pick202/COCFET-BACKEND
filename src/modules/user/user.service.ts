import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** L'email est supposé déjà normalisé par l'appelant. */
  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  create(data: Partial<User>): Promise<User> {
    return this.users.save(this.users.create(data));
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    await this.users.update(id, data);
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException("Cet utilisateur n'existe pas.");
    }
    return user;
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.users.update(id, { refreshTokenHash: hash });
  }
}
