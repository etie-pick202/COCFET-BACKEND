import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Generation } from '../generation/entities/generation.entity';
import { MailModule } from '../mail/mail.module';
import { User } from '../user/entities/user.entity';
import { BureauController } from './bureau.controller';
import { BureauService } from './bureau.service';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PosteBureau, MembreBureau, Generation, User]),
    // Pour accueillir un membre fraîchement désigné. Aucun cycle : le courrier
    // ne dépend que du module de la charte, qui ne connaît aucun métier.
    MailModule,
  ],
  controllers: [BureauController],
  providers: [BureauService],
  exports: [BureauService],
})
export class BureauModule {}
