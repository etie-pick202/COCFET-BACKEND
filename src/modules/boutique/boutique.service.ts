import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { DeclinaisonProduit } from './entities/declinaison-produit.entity';

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
    @InjectRepository(DeclinaisonProduit)
    private readonly declinaisons: Repository<DeclinaisonProduit>,
    private readonly generationService: GenerationService,
    private readonly nettoyage: NettoyageFichiers,
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
    const imagesAvant = produit.images ? [...produit.images] : null;

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

    const enregistre = await this.produits.save(produit);

    // Seules les images retirees du lot partent : un produit perd une photo
    // sur cinq, les quatre autres restent.
    await this.nettoyage.remplacerLot(imagesAvant, dto.images);

    return enregistre;
  }

  /**
   * Retire un produit du catalogue sans l'effacer.
   *
   * Les lignes de commande le référencent en `RESTRICT` : le supprimer
   * emporterait l'historique des achats, ou échouerait. Le statut `RETIRE` le
   * fait disparaître de la vitrine tout en gardant les commandes lisibles.
   *
   * **Ses images restent donc en place.** Le produit n'est pas effacé : il
   * continue de s'afficher dans les commandes déjà passées, et les effacer
   * remplacerait l'article acheté par un cadre vide dans un historique que le
   * client peut relire des mois plus tard.
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
  async reserverStock(
    id: string,
    quantite: number,
    taille: string | null = null,
    couleur: string | null = null,
  ): Promise<boolean> {
    const demande = Math.trunc(quantite);

    // Le stock detaille fait foi des qu'il existe : decrementer le compteur
    // global laisserait vendre un M alors qu'il n'en reste plus, le total
    // pouvant tenir a lui seul grace aux autres tailles.
    const declinaison = await this.declinaisonDe(id, taille, couleur);

    if (declinaison) {
      const surDeclinaison = await this.declinaisons
        .createQueryBuilder()
        .update(DeclinaisonProduit)
        .set({ stock: () => `stock - ${demande}` })
        .where('id = :id AND stock >= :quantite', {
          id: declinaison.id,
          quantite: demande,
        })
        .execute();

      if (surDeclinaison.affected !== 1) {
        return false;
      }
    }

    const resultat = await this.produits
      .createQueryBuilder()
      .update(Produit)
      .set({ stock: () => `stock - ${demande}` })
      .where('id = :id AND stock >= :quantite', { id, quantite: demande })
      .execute();

    if (resultat.affected !== 1) {
      // Le total et le detail ont diverge : la declinaison a accepte, le
      // compteur global non. On rend ce qu'on vient de prendre plutot que de
      // laisser une reservation a moitie faite.
      if (declinaison) {
        await this.declinaisons.increment(
          { id: declinaison.id },
          'stock',
          demande,
        );
      }
      return false;
    }

    await this.rafraichirStatut(id);
    return true;
  }

  /**
   * Retrouve la declinaison exacte, ou rien si le produit n'en a pas.
   *
   * L'absence de declinaison n'est pas une erreur : un porte-cles se vend sans
   * taille ni couleur, et son stock global suffit.
   */
  private async declinaisonDe(
    produitId: string,
    taille: string | null,
    couleur: string | null,
  ): Promise<DeclinaisonProduit | null> {
    const total = await this.declinaisons.countBy({
      produit: { id: produitId },
    });
    if (total === 0) {
      return null;
    }

    // « IsNull » plutot que « null » : TypeORM traduit le second en egalite,
    // et « = NULL » ne vaut jamais vrai en SQL — la declinaison sans taille ne
    // serait alors jamais retrouvee.
    return this.declinaisons.findOne({
      where: {
        produit: { id: produitId },
        taille: taille ?? IsNull(),
        couleur: couleur ?? IsNull(),
      },
    });
  }

  /** Restitue une quantité réservée — annulation, ou paiement non abouti. */
  async libererStock(
    id: string,
    quantite: number,
    taille: string | null = null,
    couleur: string | null = null,
  ): Promise<void> {
    // Rendue a la declinaison exacte : remettre la quantite au seul compteur
    // global gonflerait le total sans qu'aucune taille ne redevienne
    // disponible.
    const declinaison = await this.declinaisonDe(id, taille, couleur);
    if (declinaison) {
      await this.declinaisons.increment(
        { id: declinaison.id },
        'stock',
        Math.trunc(quantite),
      );
    }

    await this.produits
      .createQueryBuilder()
      .update(Produit)
      .set({ stock: () => `stock + ${Math.trunc(quantite)}` })
      .where('id = :id', { id })
      .execute();

    await this.rafraichirStatut(id);
  }

  /**
   * Remplace l'ensemble des declinaisons d'un produit.
   *
   * Remplacement global plutot que retouche ligne a ligne : le bureau saisit
   * une grille — tailles fois couleurs — et la corrige en bloc. La somme des
   * stocks devient celle du produit, qui cesse d'etre saisie directement.
   *
   * **Refuse tant qu'une commande est en cours de preparation** n'aurait pas de
   * sens ici : les lignes deja passees ont fige leur quantite, et le stock
   * qu'on redefinit est celui qui reste a vendre.
   */
  async definirDeclinaisons(
    id: string,
    lignes: {
      taille?: string | null;
      couleur?: string | null;
      stock: number;
    }[],
  ): Promise<Produit> {
    await this.trouverOuEchouer(id);

    const vues = new Set<string>();
    for (const ligne of lignes) {
      const cle = `${ligne.taille ?? ''}|${ligne.couleur ?? ''}`;
      if (vues.has(cle)) {
        // Deux lignes pour le meme couple rendraient le stock indetermine, et
        // la reservation atomique choisirait au hasard laquelle decrementer.
        throw new BadRequestException(
          `La combinaison « ${ligne.taille ?? 'sans taille'} / ${ligne.couleur ?? 'sans couleur'} » est saisie deux fois.`,
        );
      }
      vues.add(cle);
    }

    await this.declinaisons.delete({ produit: { id } });

    if (lignes.length > 0) {
      await this.declinaisons.save(
        lignes.map((ligne) =>
          this.declinaisons.create({
            produit: { id } as Produit,
            taille: ligne.taille ?? null,
            couleur: ligne.couleur ?? null,
            stock: Math.max(0, Math.trunc(ligne.stock)),
          }),
        ),
      );
    }

    const total = lignes.reduce(
      (somme, ligne) => somme + Math.max(0, Math.trunc(ligne.stock)),
      0,
    );
    await this.produits.update(id, { stock: total });

    return this.rafraichirStatut(id);
  }

  /** Les declinaisons d'un produit, avec leur stock. */
  declinaisonsDe(id: string): Promise<DeclinaisonProduit[]> {
    return this.declinaisons.find({
      where: { produit: { id } },
      order: { taille: 'ASC', couleur: 'ASC' },
    });
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
