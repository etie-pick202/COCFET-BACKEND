import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { beneficieDuTarifCampus } from '../../common/identite/identite-campus';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { Evenement } from '../evenement/entities/evenement.entity';
import { GenerationService } from '../generation/generation.service';
import { User } from '../user/entities/user.entity';
import {
  CreerProduitDto,
  FiltreProduitDto,
  MettreAJourProduitDto,
  ProduitAvecTarif,
} from './dto/boutique.dto';
import { Produit, StatutProduit } from './entities/produit.entity';

const TRIS_AUTORISES = ['createdAt', 'nom', 'prixCampus'] as const;

/** Statuts qu'un visiteur peut voir. Un produit retiré n'existe plus pour lui. */
const VISIBLES_DU_PUBLIC = [
  StatutProduit.DISPONIBLE,
  StatutProduit.PRECOMMANDE,
  StatutProduit.RUPTURE,
];

@Injectable()
export class BoutiqueService {
  constructor(
    @InjectRepository(Produit)
    private readonly produits: Repository<Produit>,
    @InjectRepository(Evenement)
    private readonly evenements: Repository<Evenement>,
    private readonly generationService: GenerationService,
  ) {}

  async creer(dto: CreerProduitDto): Promise<Produit> {
    const produit = this.produits.create({
      ...this.champs(dto),
      evenement: await this.evenementRattache(dto.evenementId),
      stock: dto.stock ?? 0,
    });

    // Créé en rupture s'il n'a pas de stock : afficher « disponible » un
    // article que personne ne peut recevoir ferait passer la déception du
    // catalogue à la commande.
    produit.statut = this.statutSelonStock(produit, produit.stock);

    return this.produits.save(produit);
  }

  async mettreAJour(id: string, dto: MettreAJourProduitDto): Promise<Produit> {
    const produit = await this.trouverOuEchouer(id);

    Object.assign(produit, this.champs(dto));

    if (dto.evenementId !== undefined) {
      produit.evenement = await this.evenementRattache(dto.evenementId);
    }
    if (dto.stock !== undefined) {
      throw new BadRequestException(
        'Le stock se corrige par « PATCH /produits/:id/stock » : une écriture ' +
          'directe écraserait ce qu’une commande simultanée vient de retirer.',
      );
    }

    produit.statut = this.statutSelonStock(produit, produit.stock);

    return this.produits.save(produit);
  }

  /**
   * Retire un produit du catalogue sans l'effacer.
   *
   * Les lignes de commande le référencent en `RESTRICT` : le supprimer
   * emporterait l'historique des achats, ou échouerait. Le statut `RETIRE` le
   * fait disparaître de la vitrine tout en gardant les commandes lisibles.
   */
  async retirer(id: string): Promise<Produit> {
    const produit = await this.trouverOuEchouer(id);
    produit.statut = StatutProduit.RETIRE;

    return this.produits.save(produit);
  }

  async lister(
    filtre: FiltreProduitDto,
    demandeur?: { role: Role },
  ): Promise<ResultatPagine<Produit>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');
    const administrateur = demandeur?.role === Role.ADMIN;

    const requete = this.produits
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.evenement', 'e');

    if (administrateur && filtre.statut) {
      requete.andWhere('p.statut = :statut', { statut: filtre.statut });
    } else {
      // Le filtre de statut d'un non-administrateur est ignoré, pas honoré :
      // le demander explicitement ne doit pas contourner la règle.
      requete.andWhere('p.statut IN (:...visibles)', {
        visibles: VISIBLES_DU_PUBLIC,
      });
    }

    if (filtre.categorie) {
      requete.andWhere('p.categorie = :categorie', {
        categorie: filtre.categorie,
      });
    }
    if (filtre.evenementId) {
      requete.andWhere('p.evenement_id = :evenementId', {
        evenementId: filtre.evenementId,
      });
    }
    if (filtre.disponibleSeulement) {
      requete.andWhere('(p.stock > 0 OR p.statut = :precommande)', {
        precommande: StatutProduit.PRECOMMANDE,
      });
    }
    if (filtre.recherche) {
      requete.andWhere(
        '(p.nom ILIKE :recherche OR p.description ILIKE :recherche)',
        { recherche: `%${filtre.recherche}%` },
      );
    }

    requete
      .orderBy(`p.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  /**
   * Fiche d'un produit.
   *
   * Un produit retiré répond 404 au public, comme un identifiant inconnu :
   * distinguer les deux révélerait qu'un article a existé, et ce qu'il était.
   */
  async trouver(id: string, demandeur?: { role: Role }): Promise<Produit> {
    const produit = await this.produits.findOne({
      where: { id },
      relations: { evenement: true },
    });

    const visible =
      produit &&
      (demandeur?.role === Role.ADMIN ||
        produit.statut !== StatutProduit.RETIRE);

    if (!visible) {
      throw new NotFoundException("Ce produit n'existe pas.");
    }

    return produit;
  }

  /** Tarif et disponibilité calculés pour le demandeur. */
  async detailPour(produit: Produit, user?: User): Promise<ProduitAvecTarif> {
    const generation = await this.generationService.trouverActive();
    const tarifCampus =
      generation !== null &&
      user !== undefined &&
      beneficieDuTarifCampus(user.promotion, generation.annee);

    return {
      prixApplicable: tarifCampus ? produit.prixCampus : produit.prixExterne,
      tarifCampus,
      commandable: this.commandable(produit),
    };
  }

  /**
   * Corrige le stock, et n'accepte jamais de le rendre négatif.
   *
   * Le delta est appliqué **dans la condition même** de la mise à jour :
   * `WHERE stock + :delta >= 0`. Lire puis écrire laisserait deux corrections
   * simultanées passer la vérification avant que l'une ait écrit — c'est
   * exactement ainsi qu'on vend un article qu'on n'a plus.
   */
  async ajusterStock(id: string, delta: number): Promise<Produit> {
    await this.trouverOuEchouer(id);

    const resultat = await this.produits
      .createQueryBuilder()
      .update(Produit)
      .set({ stock: () => `stock + ${Math.trunc(delta)}` })
      .where(`id = :id AND stock + ${Math.trunc(delta)} >= 0`, { id })
      .execute();

    if (resultat.affected !== 1) {
      throw new BadRequestException(
        'Cette correction rendrait le stock négatif.',
      );
    }

    return this.rafraichirStatut(id);
  }

  /**
   * Réserve une quantité, de façon atomique.
   *
   * Utilisée à la commande : la condition porte sur le stock courant dans la
   * requête elle-même, si bien que deux commandes concurrentes sur le dernier
   * article ne peuvent pas aboutir toutes les deux.
   *
   * Rend `false` quand il n'y a pas assez de stock.
   */
  async reserverStock(id: string, quantite: number): Promise<boolean> {
    const resultat = await this.produits
      .createQueryBuilder()
      .update(Produit)
      .set({ stock: () => `stock - ${Math.trunc(quantite)}` })
      .where('id = :id AND stock >= :quantite', {
        id,
        quantite: Math.trunc(quantite),
      })
      .execute();

    if (resultat.affected !== 1) {
      return false;
    }

    await this.rafraichirStatut(id);
    return true;
  }

  /** Restitue une quantité réservée — annulation, ou paiement non abouti. */
  async libererStock(id: string, quantite: number): Promise<void> {
    await this.produits
      .createQueryBuilder()
      .update(Produit)
      .set({ stock: () => `stock + ${Math.trunc(quantite)}` })
      .where('id = :id', { id })
      .execute();

    await this.rafraichirStatut(id);
  }

  async trouverOuEchouer(id: string): Promise<Produit> {
    const produit = await this.produits.findOne({
      where: { id },
      relations: { evenement: true },
    });

    if (!produit) {
      throw new NotFoundException("Ce produit n'existe pas.");
    }

    return produit;
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  /**
   * Réaligne le statut sur le stock réel.
   *
   * `RETIRE` et `PRECOMMANDE` ne bougent pas : le premier est une décision du
   * bureau, le second se vend précisément **sans** stock. Les rétablir
   * automatiquement remettrait en vente ce qu'on a délibérément sorti.
   */
  private async rafraichirStatut(id: string): Promise<Produit> {
    const produit = await this.trouverOuEchouer(id);
    const attendu = this.statutSelonStock(produit, produit.stock);

    if (attendu !== produit.statut) {
      produit.statut = attendu;
      await this.produits.save(produit);
    }

    return produit;
  }

  private statutSelonStock(produit: Produit, stock: number): StatutProduit {
    if (
      produit.statut === StatutProduit.RETIRE ||
      produit.statut === StatutProduit.PRECOMMANDE
    ) {
      return produit.statut;
    }

    return stock > 0 ? StatutProduit.DISPONIBLE : StatutProduit.RUPTURE;
  }

  private commandable(produit: Produit): boolean {
    if (produit.statut === StatutProduit.PRECOMMANDE) {
      // Une précommande s'accepte sans stock : c'est sa raison d'être.
      return true;
    }

    return produit.statut === StatutProduit.DISPONIBLE && produit.stock > 0;
  }

  private champs(dto: CreerProduitDto | MettreAJourProduitDto) {
    return {
      ...(dto.nom !== undefined && { nom: dto.nom }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.prixCampus !== undefined && { prixCampus: dto.prixCampus }),
      ...(dto.prixExterne !== undefined && { prixExterne: dto.prixExterne }),
      ...(dto.categorie !== undefined && { categorie: dto.categorie }),
      ...(dto.tailles !== undefined && { tailles: dto.tailles }),
      ...(dto.couleurs !== undefined && { couleurs: dto.couleurs }),
      ...(dto.images !== undefined && { images: dto.images }),
      ...(dto.datePrecommande !== undefined && {
        datePrecommande: new Date(dto.datePrecommande),
        // Une date de disponibilité annoncée fait basculer l'article en
        // précommande : sans cela, il resterait « en rupture » alors qu'il est
        // justement ouvert aux commandes.
        statut: StatutProduit.PRECOMMANDE,
      }),
    } as Partial<Produit>;
  }

  private async evenementRattache(id?: string): Promise<Evenement | null> {
    if (!id) {
      return null;
    }

    const evenement = await this.evenements.findOne({ where: { id } });
    if (!evenement) {
      throw new NotFoundException("Cet événement n'existe pas.");
    }

    return evenement;
  }
}
