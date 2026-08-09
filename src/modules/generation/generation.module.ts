import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { Generation } from './entities/generation.entity';
import { GenerationController } from './generation.controller';
import { FileModule } from '../file/file.module';
import { GenerationService } from './generation.service';
import { IdentiteVisuelleService } from './identite-visuelle.service';

@Module({
  imports: [TypeOrmModule.forFeature([Generation]), BureauModule, FileModule],
  controllers: [GenerationController],
  providers: [GenerationService, IdentiteVisuelleService],
  exports: [GenerationService, IdentiteVisuelleService],
})
export class GenerationModule {}
