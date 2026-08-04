import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Generation } from './entities/generation.entity';

@Injectable()
export class GenerationService {
  constructor(
    @InjectRepository(Generation)
    private readonly generations: Repository<Generation>,
  ) {}

  /**
   * Génération en cours de mandat.
   *
   * Renvoie null tant qu'aucune n'est active — cas d'une base fraîchement
   * installée. Les appelants doivent traiter ce cas plutôt que de le supposer
   * impossible : sans génération active, aucune promotion ne peut être
   * qualifiée de finissante ni bénéficier du tarif campus.
   */
  trouverActive(): Promise<Generation | null> {
    return this.generations.findOne({ where: { isActive: true } });
  }
}
