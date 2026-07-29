import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Generation } from './entities/generation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Generation])],
})
export class GenerationModule {}
