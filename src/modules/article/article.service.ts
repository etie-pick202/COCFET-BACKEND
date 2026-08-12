import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import {
  CreerArticleDto,
  FiltreArticleDto,
  MettreAJourArticleDto,
} from './dto/article.dto';
import { Article, StatutArticle } from './entities/article.entity';
import { slugLibre } from './slug';

const TRIS_AUTORISES = ['publishedAt', 'createdAt', 'titre'] as const;

/** Longueur de l'extrait déduit du contenu, quand aucun n'est fourni. */
const LONGUEUR_EXTRAIT = 200;

@Injectable()
export class ArticleService {
  private readonly logger = new Logger(ArticleService.name);

  /** Borne un passage de la tâche : une rafale d'annonces se lisse. */
  private static readonly PAR_PASSAGE = 50;

  constructor(
    @InjectRepository(Article)
    private readonly articles: Repository<Article>,
    private readonly notificationService: NotificationService,
  ) {}

  // ─────────────────────────────  Lecture  ──────────────────────────────

  /**
   * Liste les actualités.
   *
   * Un non-administrateur ne voit que les articles **parus** : ni les
   * brouillons, ni les archives, ni les articles programmés dont l'heure n'est
   * pas venue. Le filtre qu'il envoie n'y change rien — laisser `statut`
   * décider côté client rendrait tout brouillon lisible d'une requête.
   */
  async lister(
    filtre: FiltreArticleDto,
    demandeur?: { role: Role },
  ): Promise<ResultatPagine<Article>> {
    const administrateur = demandeur?.role === Role.ADMIN;
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'publishedAt');

    const requete = this.articles
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.auteur', 'auteur')
      .leftJoinAndSelect('a.evenement', 'evenement');

    if (administrateur) {
      if (filtre.statut) {
        requete.andWhere('a.statut = :statut', { statut: filtre.statut });
      }
      if (filtre.programmes) {
        requete
          .andWhere('a.published_at IS NOT NULL')
          .andWhere('a.published_at > :maintenant', { maintenant: new Date() });
      }
    } else {
      this.restreindreAuxParus(requete);
    }

    if (filtre.categorie) {
      requete.andWhere('a.categorie = :categorie', {
        categorie: filtre.categorie,
      });
    }
    if (filtre.evenementId) {
      requete.andWhere('a.evenement_id = :evenementId', {
        evenementId: filtre.evenementId,
      });
    }
    if (filtre.recherche) {
      // Paramétré, jamais concaténé : la valeur vient du client.
      const motif = `%${filtre.recherche}%`;
      requete.andWhere(
        new Brackets((q) =>
          q
            .where('a.titre ILIKE :motif', { motif })
            .orWhere('a.extrait ILIKE :motif', { motif }),
        ),
      );
    }

    requete
      .orderBy(`a.${tri}`, filtre.ordre, 'NULLS LAST')
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  /** Les catégories réellement utilisées par des articles parus. */
  async categories(): Promise<string[]> {
    const requete = this.articles
      .createQueryBuilder('a')
      .select('DISTINCT a.categorie', 'categorie')
      .andWhere('a.categorie IS NOT NULL');

    this.restreindreAuxParus(requete);

    const lignes = await requete.getRawMany<{ categorie: string }>();

    return lignes
      .map((ligne) => ligne.categorie)
      .sort((a, b) => a.localeCompare(b));
  }

  trouver(id: string, demandeur?: { role: Role }): Promise<Article> {
    return this.trouverPar({ id }, demandeur);
  }

  /**
   * Consultation par slug — c'est la forme partagée d'une URL d'article.
   *
   * L'identifiant technique reste accepté par ailleurs, pour l'administration ;
   * une adresse publique, elle, doit rester lisible et stable.
   */
  trouverParSlug(slug: string, demandeur?: { role: Role }): Promise<Article> {
    return this.trouverPar({ slug }, demandeur);
  }

  // ────────────────────────────  Écriture  ──────────────────────────────

  async creer(dto: CreerArticleDto, auteurId: string): Promise<Article> {
    const { evenementId, ...reste } = dto;

    const article = await this.articles.save(
      this.articles.create({
        ...reste,
        slug: await this.slugPour(dto.titre),
        extrait: dto.extrait ?? this.extraitDeduit(dto.contenu),
        auteur: { id: auteurId },
        ...(evenementId ? { evenement: { id: evenementId } } : {}),
        statut: StatutArticle.BROUILLON,
        publishedAt: null,
      }),
    );

    return this.trouver(article.id, { role: Role.ADMIN });
  }

  /**
   * Modifie un article.
   *
   * **Le slug ne suit pas le titre.** Une correction de faute de frappe
   * casserait sinon toutes les adresses déjà partagées, et les liens entrants
   * tomberaient sur une page inexistante. Le slug est fixé à la création.
   */
  async mettreAJour(id: string, dto: MettreAJourArticleDto): Promise<Article> {
    await this.trouver(id, { role: Role.ADMIN });

    const { evenementId, ...reste } = dto;

    await this.articles.update(id, {
      ...reste,
      ...(evenementId !== undefined ? { evenement: { id: evenementId } } : {}),
    });

    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Fait paraître l'article, tout de suite ou à l'heure dite.
   *
   * Une date future **programme** la parution : l'article passe en `PUBLIE`
   * mais `publishedAt` reste devant nous, ce qui suffit à le tenir hors des
   * listes publiques — c'est la même condition qui le rendra visible le moment
   * venu, sans qu'aucune tâche n'ait à repasser derrière. La diffusion, elle,
   * est confiée à {@link diffuserLesParutionsDues}.
   *
   * Republier un article déjà paru ne renotifie personne : une correction de
   * faute de frappe ne doit pas alerter toute la promotion.
   */
  async publier(id: string, le?: string): Promise<Article> {
    const article = await this.trouver(id, { role: Role.ADMIN });

    if (article.statut === StatutArticle.ARCHIVE) {
      throw new BadRequestException(
        'Un article archivé ne peut pas être republié.',
      );
    }
    if (article.statut === StatutArticle.PUBLIE && !le) {
      return article;
    }

    const parution = le ? new Date(le) : new Date();

    if (Number.isNaN(parution.getTime())) {
      throw new BadRequestException('La date de parution est invalide.');
    }

    await this.articles.update(id, {
      statut: StatutArticle.PUBLIE,
      publishedAt: parution,
    });

    if (parution.getTime() <= Date.now()) {
      await this.annoncer(article);
    } else {
      this.logger.log(
        `Article « ${article.titre} » programmé pour le ${parution.toISOString()}.`,
      );
    }

    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Annonce les articles dont l'heure de parution vient d'arriver.
   *
   * Appelée par la tâche planifiée. La diffusion est marquée par
   * `annonceLe` : sans cette trace, chaque passage de la tâche renotifierait
   * les mêmes articles, et un article programmé un vendredi soir réveillerait
   * la promotion toutes les cinq minutes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async diffuserLesParutionsDues(maintenant = new Date()): Promise<number> {
    const dus = await this.articles.find({
      where: {
        statut: StatutArticle.PUBLIE,
        publishedAt: LessThanOrEqual(maintenant),
        annonceLe: IsNull(),
      },
      order: { publishedAt: 'ASC' },
      take: ArticleService.PAR_PASSAGE,
    });

    for (const article of dus) {
      await this.annoncer(article);
    }

    return dus.length;
  }

  async archiver(id: string): Promise<Article> {
    await this.trouver(id, { role: Role.ADMIN });
    await this.articles.update(id, { statut: StatutArticle.ARCHIVE });
    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Supprime un article.
   *
   * Refusé dès qu'il a paru : une adresse partagée, indexée par les moteurs ou
   * relayée sur les réseaux, ne doit pas se terminer par une page inexistante.
   * L'archivage est la sortie prévue pour un article qui a vécu.
   */
  async supprimer(id: string): Promise<void> {
    const article = await this.trouver(id, { role: Role.ADMIN });

    if (article.statut !== StatutArticle.BROUILLON) {
      throw new BadRequestException(
        'Cet article a déjà paru : archivez-le plutôt que de le supprimer.',
      );
    }

    await this.articles.delete(id);
  }

  // ─────────────────────────────  Interne  ──────────────────────────────

  /**
   * Condition de visibilité publique, en un seul endroit.
   *
   * Un article programmé porte le statut `PUBLIE` avec une date à venir : le
   * statut seul ne suffit donc pas à décider ce que le public voit.
   */
  private restreindreAuxParus(requete: {
    andWhere: (condition: string, parametres?: object) => unknown;
  }): void {
    requete.andWhere('a.statut = :publie', { publie: StatutArticle.PUBLIE });
    requete.andWhere('a.published_at IS NOT NULL');
    requete.andWhere('a.published_at <= :maintenant', {
      maintenant: new Date(),
    });
  }

  private async trouverPar(
    critere: { id: string } | { slug: string },
    demandeur?: { role: Role },
  ): Promise<Article> {
    const article = await this.articles.findOne({
      where: critere,
      relations: { auteur: true, evenement: true },
    });

    const paru =
      article?.statut === StatutArticle.PUBLIE &&
      article.publishedAt !== null &&
      article.publishedAt.getTime() <= Date.now();

    if (!article || (!paru && demandeur?.role !== Role.ADMIN)) {
      // Même réponse qu'un identifiant inconnu : distinguer les deux
      // révélerait l'existence d'un brouillon, titre compris dans l'URL.
      throw new NotFoundException("Cet article n'existe pas.");
    }

    return article;
  }

  private slugPour(titre: string): Promise<string> {
    return slugLibre(
      titre,
      async (slug) => (await this.articles.countBy({ slug })) > 0,
    );
  }

  /**
   * Déduit une accroche du corps de l'article.
   *
   * Coupée sur une frontière de mot : tronquer au caractère près produit des
   * accroches finissant au milieu d'un mot, ce qui se remarque dans une liste.
   */
  private extraitDeduit(contenu: string): string {
    const propre = contenu.replace(/\s+/g, ' ').trim();

    if (propre.length <= LONGUEUR_EXTRAIT) {
      return propre;
    }

    const coupe = propre.slice(0, LONGUEUR_EXTRAIT);
    const dernierEspace = coupe.lastIndexOf(' ');

    return `${coupe.slice(0, dernierEspace > 0 ? dernierEspace : LONGUEUR_EXTRAIT)}…`;
  }

  /** Diffuse l'annonce, une seule fois par article. */
  private async annoncer(article: Article): Promise<void> {
    // Marqué avant la diffusion : si l'envoi échoue à mi-parcours, on préfère
    // une annonce manquée à une annonce répétée à chaque passage de la tâche.
    const marque = await this.articles.update(
      { id: article.id, annonceLe: IsNull() },
      { annonceLe: new Date() },
    );

    if (marque.affected !== 1) {
      return;
    }

    await this.notificationService.diffuser({
      type: TypeNotification.ARTICLE,
      titre: `Nouvel article : ${article.titre}`,
      message: article.extrait ?? article.titre,
      lien: `/actualites/${article.slug}`,
    });

    this.logger.log(`Article annoncé : ${article.titre}`);
  }
}
