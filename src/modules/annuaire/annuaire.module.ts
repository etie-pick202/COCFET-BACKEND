import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilFinissant } from './entities/profil-finissant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProfilFinissant])],
})
export class AnnuaireModule {}
