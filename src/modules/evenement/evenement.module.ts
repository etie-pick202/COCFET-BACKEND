import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Evenement } from './entities/evenement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Evenement])],
})
export class EvenementModule {}
