import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalActivite } from '../activite/entities/journal-activite.entity';
import { FileModule } from '../file/file.module';
import { Sponsor } from '../sponsor/entities/sponsor.entity';
import { User } from '../user/entities/user.entity';
import { AnnuaireController } from './annuaire.controller';
import { AnnuaireService } from './annuaire.service';
import { ProfilFinissant } from './entities/profil-finissant.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProfilFinissant, Sponsor, User, JournalActivite]),
    FileModule,
  ],
  controllers: [AnnuaireController],
  providers: [AnnuaireService],
  exports: [AnnuaireService],
})
export class AnnuaireModule {}
