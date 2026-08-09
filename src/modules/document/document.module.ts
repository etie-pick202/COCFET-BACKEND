import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { BureauModule } from '../bureau/bureau.module';
import { Commande } from '../commande/entities/commande.entity';
import { FileModule } from '../file/file.module';
import { GenerationModule } from '../generation/generation.module';
import { TableauDeBordModule } from '../tableau-de-bord/tableau-de-bord.module';
import { User } from '../user/entities/user.entity';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { Document } from './entities/document.entity';

/**
 * Les pièces justificatives émises par la plateforme.
 *
 * Le module lit commandes et inscriptions par leurs dépôts plutôt que par
 * leurs services : il n'applique aucune règle métier, il recopie un état à un
 * instant donné. Passer par les services ferait dépendre l'émission d'un
 * document de règles qui n'ont rien à voir avec elle.
 *
 * `TableauDeBordModule` est importé pour la trésorerie — le rapport reprend
 * exactement les chiffres de l'écran, ce qui serait faux si le calcul était
 * réécrit ici. `BureauModule` l'est pour le garde de privilèges.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Commande, Inscription, User]),
    FileModule,
    GenerationModule,
    TableauDeBordModule,
    BureauModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
