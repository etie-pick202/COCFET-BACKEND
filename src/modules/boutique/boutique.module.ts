import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileModule } from '../file/file.module';
import { Evenement } from '../evenement/entities/evenement.entity';
import { GenerationModule } from '../generation/generation.module';
import { UserModule } from '../user/user.module';
import { BoutiqueController } from './boutique.controller';
import { BoutiqueService } from './boutique.service';
import { Produit } from './entities/produit.entity';
import { DeclinaisonProduit } from './entities/declinaison-produit.entity';

/**
 * `Evenement` est déclaré ici alors qu'il appartient à un autre module : seul
 * le dépôt est nécessaire, pour vérifier qu'un rattachement pointe vers un
 * événement réel. Importer `EvenementModule` entier créerait un cycle, la
 * billetterie dépendant déjà de la boutique par les produits d'un événement.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Produit, DeclinaisonProduit, Evenement]),
    GenerationModule,
    UserModule,
    FileModule,
  ],
  controllers: [BoutiqueController],
  providers: [BoutiqueService],
  exports: [BoutiqueService],
})
export class BoutiqueModule {}
