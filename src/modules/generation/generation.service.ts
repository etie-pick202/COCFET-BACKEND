import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BureauService } from '../bureau/bureau.service';
import type { Stockage } from '../file/ports/stockage';
import { STOCKAGE } from '../file/ports/stockage';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { Produit } from '../boutique/entities/produit.entity';
import { Evenement } from '../evenement/entities/evenement.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { Role } from '../../common/enums/role.enum';
import { User } from '../user/entities/user.entity';
import {
  CreerGenerationDto,
  MettreAJourGenerationDto,
  ThemeGeneration,
} from './dto/generation.dto';
import { Generation } from './entities/generation.entity';

/** Ce que renvoie le thème quand aucune génération n'est active. */
const THEME_PAR_DEFAUT: ThemeGeneration = {
  annee: null,
  nom: null,
  logo: null,
  couleurPrimaire: '#000000',
  couleurSecondaire: '#FFFFFF',
};

/**
 * Plafond des déclinaisons d'un mandat.
 *
 * Un bureau en fait produire quelques-unes — fond clair, fond sombre,
 * monochrome. Au-delà, c'est un dépôt de fichiers qui s'installe.
 */
const MAX_LOGOS = 10;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectRepository(Generation)
    private readonly generations: Repository<Generation>,
    private readonly dataSource: DataSource,
    private readonly bureauService: BureauService,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
  ) {}

  /**
   * Génération en cours de mandat.
   *
   * Renvoie null tant qu'aucune n'est active — cas d'une base fraîchement
   * installée. Les appelants doivent traiter ce cas plutôt que de le supposer
   * impossible : sans génération active, aucune promotion ne peut être
   * qualifiée de finissante ni bénéficier du tarif campus.
   */
  trouverActive(): Promise<Generation | null> {
    return this.generations.findOne({ where: { isActive: true } });
  }

  /**
   * Thème de la génération active.
   *
   * Renvoie des valeurs neutres plutôt qu'une erreur quand aucune n'est
   * active : le frontend doit pouvoir s'afficher sur une plateforme qui vient
   * d'être installée, pas rester bloqué sur un écran blanc.
   */
  async theme(): Promise<ThemeGeneration> {
    const active = await this.trouverActive();

    if (!active) {
      return THEME_PAR_DEFAUT;
    }

    return {
      annee: active.annee,
      nom: active.nom,
      logo: active.logo,
      couleurPrimaire: active.couleurPrimaire,
      couleurSecondaire: active.couleurSecondaire,
    };
  }

  lister(): Promise<Generation[]> {
    return this.generations.find({ order: { annee: 'DESC' } });
  }

  async trouver(id: string): Promise<Generation> {
    const generation = await this.generations.findOne({ where: { id } });

    if (!generation) {
      throw new NotFoundException("Cette génération n'existe pas.");
    }

    return generation;
  }

  async creer(dto: CreerGenerationDto): Promise<Generation> {
    await this.verifierAnneeLibre(dto.annee);

    // Jamais active à la création : l'activation a ses propres effets de bord
    // — bascule de la précédente, recalcul des finissants — et mérite un geste
    // explicite.
    return this.generations.save(
      this.generations.create({ ...dto, isActive: false }),
    );
  }

  async mettreAJour(
    id: string,
    dto: MettreAJourGenerationDto,
  ): Promise<Generation> {
    const generation = await this.trouver(id);

    if (generation.archivedAt) {
      // Les statistiques d'une génération archivée sont figées : en modifier
      // l'année ou le nom rendrait les chiffres conservés incompréhensibles.
      throw new ConflictException(
        "Cette génération est archivée : elle n'est plus modifiable.",
      );
    }

    if (dto.annee !== undefined && dto.annee !== generation.annee) {
      await this.verifierAnneeLibre(dto.annee);
    }

    await this.generations.update(id, dto);

    return this.trouver(id);
  }

  /**
   * Active une génération et bascule la plateforme.
   *
   * Tout se joue dans une seule transaction : désactivation de la précédente,
   * activation de la nouvelle, recalcul du statut de finissant. Séparer ces
   * étapes laisserait une fenêtre pendant laquelle **deux générations sont
   * actives** — le thème et la tarification deviendraient indéterminés — ou
   * pendant laquelle plus aucune ne l'est.
   *
   * `isFinissant` est **calculé, jamais saisi** : il découle de la comparaison
   * entre la promotion et l'année active, et conditionne l'appartenance à
   * l'annuaire consulté par les entreprises partenaires.
   */
  async activer(id: string): Promise<Generation> {
    const generation = await this.trouver(id);

    if (generation.archivedAt) {
      throw new ConflictException(
        'Une génération archivée ne peut pas être réactivée.',
      );
    }
    if (generation.isActive) {
      return generation;
    }

    // Un mandat ne prend pas ses fonctions sans bureau : postes cles pourvus,
    // et au moins un titulaire capable d'administrer la plateforme.
    await this.bureauService.verifierComposition(id);
    const entrants = await this.bureauService.administrateursDe(id);

    await this.dataSource.transaction(async (gestionnaire) => {
      // Désactivation d'abord : l'index partiel unique en base n'autorise
      // qu'une seule ligne active, et l'ordre inverse le violerait.
      await gestionnaire
        .createQueryBuilder()
        .update(Generation)
        .set({ isActive: false })
        .where('is_active = true')
        .execute();

      await gestionnaire
        .createQueryBuilder()
        .update(Generation)
        .set({ isActive: true })
        .where('id = :id', { id })
        .execute();

      // `promotion = :annee` vaut NULL — et non false — quand la promotion
      // est nulle : c'est le cas de tout compte externe, et l'affectation
      // violerait la contrainte NOT NULL de la colonne.
      await gestionnaire
        .createQueryBuilder()
        .update(User)
        .set({
          isFinissant: () => 'promotion IS NOT NULL AND promotion = :annee',
        })
        .setParameter('annee', generation.annee)
        .execute();

      // Passation d'administration.
      //
      // Le COCFET est un bureau de finissants : une fois la promotion sortie,
      // ses membres deviennent alumni et n'ont plus a piloter la plateforme.
      // Les entrants sont donc promus, et les sortants retrogrades.
      //
      // La condition « promotion IS NOT NULL » epargne les comptes qui n'ont
      // jamais ete etudiants — l'administration technique. Un alumni est
      // quelqu'un qui a ete etudiant ; celui qui ne l'a jamais ete n'en
      // devient pas un, et sa presence garantit qu'il reste toujours quelqu'un
      // aux commandes si une bascule se passe mal.
      await gestionnaire
        .createQueryBuilder()
        .update(User)
        .set({ role: Role.STUDENT })
        .where('role = :admin', { admin: Role.ADMIN })
        .andWhere('promotion IS NOT NULL')
        .andWhere('promotion <> :annee', { annee: generation.annee })
        .execute();

      if (entrants.length > 0) {
        await gestionnaire
          .createQueryBuilder()
          .update(User)
          .set({ role: Role.ADMIN })
          .whereInIds(entrants)
          .execute();
      }
    });

    this.logger.log(
      `Generation ${generation.annee} (${generation.nom}) activee : ` +
        `${entrants.length} administrateur(s) entrant(s), finissants recalcules.`,
    );

    return this.trouver(id);
  }

  /**
   * Archive une génération et fige ses statistiques.
   *
   * Les chiffres sont calculés **au moment de l'archivage** puis conservés
   * tels quels. Les recalculer plus tard donnerait des valeurs différentes —
   * les comptes évoluent, les événements se suppriment — et le bilan d'un
   * mandat ne serait jamais deux fois le même.
   */
  async archiver(id: string): Promise<Generation> {
    const generation = await this.trouver(id);

    if (generation.archivedAt) {
      return generation;
    }
    if (generation.isActive) {
      // Archiver la génération en cours laisserait la plateforme sans thème,
      // sans tarif campus et sans finissants. Il faut d'abord activer la
      // suivante.
      throw new ConflictException(
        'Activez d’abord une autre génération : celle-ci est en cours de mandat.',
      );
    }

    await this.generations.update(id, {
      archivedAt: new Date(),
      stats: await this.calculerStatistiques(generation),
    });

    this.logger.log(`Génération ${generation.annee} archivée.`);

    return this.trouver(id);
  }

  /**
   * Supprime une génération.
   *
   * Refusé dès qu'elle est active ou archivée : l'une porte le mandat en
   * cours, l'autre l'histoire d'un mandat passé. Seule une génération créée
   * par erreur, jamais activée, peut disparaître.
   */
  async supprimer(id: string): Promise<void> {
    const generation = await this.trouver(id);

    if (generation.isActive) {
      throw new ConflictException(
        'La génération en cours de mandat ne peut pas être supprimée.',
      );
    }
    if (generation.archivedAt) {
      throw new ConflictException(
        'Une génération archivée conserve le bilan de son mandat : elle ne se supprime pas.',
      );
    }

    await this.generations.delete(id);
  }

  /**
   * Designe le logo qui habille la plateforme.
   *
   * La cle doit figurer parmi les logos deposes : sans ce controle, une faute
   * de frappe afficherait une image inexistante, et le bureau chercherait
   * longtemps pourquoi son logo a disparu.
   */
  async designerLogo(id: string, logo: string): Promise<Generation> {
    const generation = await this.trouver(id);

    if (!generation.logos.includes(logo)) {
      throw new BadRequestException(
        'Ce logo n’a pas été déposé pour cette génération.',
      );
    }

    await this.generations.update(id, { logo });

    return this.trouver(id);
  }

  /**
   * Rattache une déclinaison au mandat.
   *
   * Idempotent : redéposer la même clé ne la duplique pas. Le frontend peut
   * rejouer l'appel après une coupure réseau sans produire deux entrées qui
   * désigneraient le même objet.
   */
  async ajouterLogo(id: string, cle: string): Promise<Generation> {
    const generation = await this.trouver(id);

    if (generation.logos.includes(cle)) {
      return generation;
    }

    if (generation.logos.length >= MAX_LOGOS) {
      throw new ConflictException(
        `Un mandat ne peut pas porter plus de ${MAX_LOGOS} déclinaisons.`,
      );
    }

    await this.generations.update(id, { logos: [...generation.logos, cle] });

    return this.trouver(id);
  }

  /**
   * Retire une déclinaison, **et la supprime du stockage**.
   *
   * Retirer la clé sans effacer l'objet laisserait un fichier payant que plus
   * rien ne référence, et qu'aucune purge ne ramasserait : le stockage ne sait
   * pas distinguer un orphelin d'un objet encore utile.
   *
   * La base est mise à jour **avant** le stockage. Dans l'autre sens, un échec
   * de la base après un effacement réussi laisserait le mandat pointant vers
   * un objet disparu — une image cassée sur la plateforme, dans les emails et
   * dans les documents. Un orphelin coûte quelques octets ; une référence
   * morte se voit.
   */
  async retirerLogo(id: string, cle: string): Promise<Generation> {
    const generation = await this.trouver(id);

    if (!generation.logos.includes(cle)) {
      throw new NotFoundException(
        'Ce logo n’a pas été déposé pour cette génération.',
      );
    }

    await this.generations.update(id, {
      logos: generation.logos.filter((autre) => autre !== cle),
      // Retirer la déclinaison qui habille la plateforme lève la désignation :
      // la charte retombe sur ses couleurs neutres plutôt que de pointer vers
      // un objet effacé.
      ...(generation.logo === cle ? { logo: null } : {}),
    });

    try {
      await this.stockage.supprimer(cle);
    } catch (erreur) {
      // La déclinaison est retirée du mandat : c'est ce que le bureau a
      // demandé, et l'échec ne doit pas le lui refuser. L'objet restera
      // orphelin, ce que le journal permet de rattraper.
      this.logger.warn(
        `Logo « ${cle} » retiré du mandat mais non supprimé du stockage : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }

    return this.trouver(id);
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private async verifierAnneeLibre(annee: number): Promise<void> {
    const existante = await this.generations.findOne({ where: { annee } });

    if (existante) {
      throw new ConflictException(`La génération ${annee} existe déjà.`);
    }
  }

  private async calculerStatistiques(
    generation: Generation,
  ): Promise<Generation['stats']> {
    const [totalEvents, totalUsers] = await Promise.all([
      this.dataSource
        .getRepository(Evenement)
        .countBy({ generation: { id: generation.id } }),
      this.dataSource
        .getRepository(User)
        .countBy({ promotion: generation.annee }),
    ]);

    // Seuls les paiements aboutis comptent : additionner les intentions restées
    // en attente gonflerait le bilan d'un mandat de sommes jamais encaissées.
    const recette = await this.dataSource
      .getRepository(Inscription)
      .createQueryBuilder('i')
      .innerJoin('i.evenement', 'e')
      .select('COALESCE(SUM(i.prix), 0)', 'total')
      .where('e.generation_id = :id', { id: generation.id })
      .andWhere('i.statut_paiement = :statut', {
        statut: StatutPaiement.COMPLETE,
      })
      .getRawOne<{ total: string }>();

    const totalProducts = await this.dataSource
      .getRepository(Produit)
      .createQueryBuilder('p')
      .innerJoin('p.evenement', 'e')
      .where('e.generation_id = :id', { id: generation.id })
      .getCount();

    return {
      totalEvents,
      totalUsers,
      totalProducts,
      totalRevenue: Number(recette?.total ?? 0),
    };
  }
}
