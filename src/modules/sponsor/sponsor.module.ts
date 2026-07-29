import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sponsor } from './entities/sponsor.entity';
import { PalierSponsor } from './entities/palier-sponsor.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Sponsor, PalierSponsor])],
})
export class SponsorModule {}
