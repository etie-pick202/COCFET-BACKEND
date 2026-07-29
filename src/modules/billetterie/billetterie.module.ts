import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inscription } from './entities/inscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Inscription])],
})
export class BilletterieModule {}
