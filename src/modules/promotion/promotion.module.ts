import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Promotion } from './entities/promotion.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Promotion])],
})
export class PromotionModule {}
