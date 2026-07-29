import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sondage } from './entities/sondage.entity';
import { OptionSondage } from './entities/option-sondage.entity';
import { Vote } from './entities/vote.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Sondage, OptionSondage, Vote])],
})
export class SondageModule {}
