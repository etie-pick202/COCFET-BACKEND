import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { Produit } from '../boutique/entities/produit.entity';
import { Evenement } from '../evenement/entities/evenement.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
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

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectRepository(Generation)
    private readonly generations: Repository<Generation>,
    private readonly dataSource: DataSource,
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
    });

    this.logger.log(
      `Génération ${generation.annee} activée : finissants recalculés.`,
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
