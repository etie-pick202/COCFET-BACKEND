import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Inscription,
  StatutInscription,
} from '../billetterie/entities/inscription.entity';
import { Produit, StatutProduit } from '../boutique/entities/produit.entity';
import { Commande, StatutCommande } from '../commande/entities/commande.entity';
import {
  Evenement,
  StatutEvenement,
} from '../evenement/entities/evenement.entity';
import { Sponsor } from '../sponsor/entities/sponsor.entity';
import { User } from '../user/entities/user.entity';
import { TableauGeneral } from './dto/tableau-de-bord.dto';

/**
 * Indicateurs d'activité, ouverts à tout le bureau.
 *
 * Aucun montant ici, et c'est délibéré : la chargée des activités a besoin de
 * savoir combien de personnes sont venues, pas ce que la soirée a rapporté.
 * Les chiffres d'argent vivent dans `TresorerieService`, derrière un
 * privilège distinct.
 */
@Injectable()
export class TableauDeBordService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Evenement)
    private readonly evenements: Repository<Evenement>,
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    @InjectRepository(Sponsor)
    private readonly sponsors: Repository<Sponsor>,
    @InjectRepository(Produit)
    private readonly produits: Repository<Produit>,
    @InjectRepository(Commande)
    private readonly commandes: Repository<Commande>,
  ) {}

  async tableau(): Promise<TableauGeneral> {
    const [
      comptes,
      finissants,
      evenementsPublies,
      evenementsAVenir,
      inscriptions,
      presences,
      sponsors,
      produits,
      commandes,
    ] = await Promise.all([
      this.users.count(),
      this.users.countBy({ isFinissant: true }),
      this.evenements.countBy({ statut: StatutEvenement.PUBLIE }),
      this.evenementsAVenir(),
      // Les annulées ne comptent pas : ce sont des places rendues, pas des
      // billets. Les inclure gonflerait la fréquentation annoncée.
      this.inscriptionsValides(),
      this.inscriptions.countBy({ statut: StatutInscription.UTILISEE }),
      this.sponsors.count(),
      this.produitsEnVente(),
      this.commandesHonorees(),
    ]);

    return {
      comptes,
      finissants,
      evenementsPublies,
      evenementsAVenir,
      inscriptions,
      presences,
      // Arrondi à l'entier : un taux de présence à la décimale près donnerait
      // une fausse impression de précision sur des effectifs de cette taille.
      tauxPresence:
        inscriptions === 0 ? 0 : Math.round((presences / inscriptions) * 100),
      sponsors,
      produits,
      commandes,
    };
  }

  private evenementsAVenir(): Promise<number> {
    return this.evenements
      .createQueryBuilder('e')
      .where('e.statut = :statut', { statut: StatutEvenement.PUBLIE })
      .andWhere('e.date_debut > :maintenant', { maintenant: new Date() })
      .getCount();
  }

  private inscriptionsValides(): Promise<number> {
    return this.inscriptions
      .createQueryBuilder('i')
      .where('i.statut != :annulee', { annulee: StatutInscription.ANNULEE })
      .getCount();
  }

  private produitsEnVente(): Promise<number> {
    return this.produits
      .createQueryBuilder('p')
      .where('p.statut != :retire', { retire: StatutProduit.RETIRE })
      .getCount();
  }

  /** Commandes réellement honorées : payées, prêtes ou retirées. */
  private commandesHonorees(): Promise<number> {
    return this.commandes
      .createQueryBuilder('c')
      .where('c.statut IN (:...statuts)', {
        statuts: [
          StatutCommande.PAYEE,
          StatutCommande.PRETE,
          StatutCommande.RETIREE,
        ],
      })
      .getCount();
  }
}
