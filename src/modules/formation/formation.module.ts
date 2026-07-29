import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Formation } from './entities/formation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Formation])],
})
export class FormationModule {}
