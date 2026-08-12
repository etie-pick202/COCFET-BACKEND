import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileModule } from '../file/file.module';
import { Generation } from './entities/generation.entity';
import { IdentiteVisuelleService } from './identite-visuelle.service';

/**
 * La charte du mandat, isolée du reste du domaine des générations.
 *
 * Elle vit à part pour une raison précise : le courrier en a besoin sur chaque
 * message, et `GenerationModule` dépend de `BureauModule`, qui dépend du
 * courrier. Faire passer la charte par le module complet fermait la boucle et
 * empêchait l'application de démarrer.
 *
 * Ce module ne connaît que deux choses — la table des mandats et le stockage —
 * et ne dépend d'aucun module métier. Rien ne peut donc reboucler par lui.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Generation]), FileModule],
  providers: [IdentiteVisuelleService],
  exports: [IdentiteVisuelleService],
})
export class IdentiteVisuelleModule {}
