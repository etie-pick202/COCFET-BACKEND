import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { FileModule } from '../file/file.module';
import { Generation } from './entities/generation.entity';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { IdentiteVisuelleModule } from './identite-visuelle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Generation]),
    BureauModule,
    FileModule,
    // La charte vit dans son propre module, sans dépendance métier : voir
    // l'explication du cycle dans `identite-visuelle.module.ts`.
    IdentiteVisuelleModule,
  ],
  controllers: [GenerationController],
  providers: [GenerationService],
  exports: [GenerationService, IdentiteVisuelleModule],
})
export class GenerationModule {}
