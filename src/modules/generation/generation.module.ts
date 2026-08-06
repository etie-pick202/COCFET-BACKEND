import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Generation } from './entities/generation.entity';
import { GenerationService } from './generation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Generation])],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
