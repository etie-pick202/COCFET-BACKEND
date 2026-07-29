import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Commande } from './entities/commande.entity';
import { LigneCommande } from './entities/ligne-commande.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Commande, LigneCommande])],
})
export class CommandeModule {}
