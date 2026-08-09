import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalActivite } from '../activite/entities/journal-activite.entity';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { Produit } from '../boutique/entities/produit.entity';
import { BureauModule } from '../bureau/bureau.module';
import { Commande } from '../commande/entities/commande.entity';
import { LigneCommande } from '../commande/entities/ligne-commande.entity';
import { Evenement } from '../evenement/entities/evenement.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import { Sponsor } from '../sponsor/entities/sponsor.entity';
import { User } from '../user/entities/user.entity';
import { TableauDeBordController } from './tableau-de-bord.controller';
import { TableauDeBordService } from './tableau-de-bord.service';
import { TresorerieService } from './tresorerie.service';

/**
 * Le module ne lit que des entités, il n'en possède aucune.
 *
 * Les dépôts sont enregistrés ici plutôt que d'appeler les services métier :
 * un tableau de bord agrège, il n'applique aucune règle. Passer par les
 * services ferait remonter des entités complètes pour n'en compter que les
 * lignes.
 *
 * `BureauModule` est importé pour le garde de privilèges, qui interroge les
 * postes à chaque requête.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      Inscription,
      LigneCommande,
      Commande,
      Produit,
      Evenement,
      Sponsor,
      User,
      JournalActivite,
    ]),
    BureauModule,
  ],
  controllers: [TableauDeBordController],
  providers: [TableauDeBordService, TresorerieService],
})
export class TableauDeBordModule {}
