import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoutiqueModule } from '../boutique/boutique.module';
import { NotificationModule } from '../notification/notification.module';
import { PaiementModule } from '../paiement/paiement.module';
import { UserModule } from '../user/user.module';
import { CommandeController } from './commande.controller';
import { CommandeService } from './commande.service';
import { Commande } from './entities/commande.entity';
import { LigneCommande } from './entities/ligne-commande.entity';

/**
 * `PaiementModule` est importé en `forwardRef` : la commande a besoin de la
 * passerelle pour encaisser, et le webhook a besoin de la commande pour la
 * confirmer. La dépendance est circulaire par nature du domaine, comme pour la
 * billetterie.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Commande, LigneCommande]),
    BoutiqueModule,
    NotificationModule,
    forwardRef(() => PaiementModule),
    UserModule,
  ],
  controllers: [CommandeController],
  providers: [CommandeService],
  exports: [CommandeService],
})
export class CommandeModule {}
