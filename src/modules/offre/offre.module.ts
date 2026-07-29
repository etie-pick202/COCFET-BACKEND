import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offre } from './entities/offre.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Offre])],
})
export class OffreModule {}
