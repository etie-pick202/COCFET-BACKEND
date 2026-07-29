import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalActivite } from './entities/journal-activite.entity';

@Module({
  imports: [TypeOrmModule.forFeature([JournalActivite])],
})
export class ActiviteModule {}
