import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Generation } from '../generation/entities/generation.entity';
import { User } from '../user/entities/user.entity';
import { BureauController } from './bureau.controller';
import { BureauService } from './bureau.service';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PosteBureau, MembreBureau, Generation, User]),
  ],
  controllers: [BureauController],
  providers: [BureauService],
  exports: [BureauService],
})
export class BureauModule {}
