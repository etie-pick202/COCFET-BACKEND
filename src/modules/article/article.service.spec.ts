import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { NotificationService } from '../notification/notification.service';
import { ArticleService } from './article.service';
import { FiltreArticleDto } from './dto/article.dto';
import {
  Article,
  AudienceArticle,
  StatutArticle,
} from './entities/article.entity';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import type { Stockage } from '../file/ports/stockage';

const HIER = new Date(Date.now() - 86_400_000);
const DEMAIN = new Date(Date.now() + 86_400_000);

/** Double du constructeur de requête de TypeORM, réduit à ce qui est appelé. */
interface ConstructeurFactice {
  leftJoinAndSelect: jest.Mock;
  select: jest.Mock;
  groupBy: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawMany: jest.Mock;
}

/** Méthodes qui se chaînent en renvoyant le constructeur lui-même. */
const CHAINABLES = [
  'leftJoinAndSelect',
  'select',
  'groupBy',
  'orderBy',
  'skip',
  'take',
] as const satisfies readonly (keyof ConstructeurFactice)[];

describe('ArticleService', () => {
  let service: ArticleService;
  let articles: {
    findOne: jest.Mock<Promise<Article | null>, [unknown]>;
    find: jest.Mock<Promise<Article[]>, [unknown]>;
    save: jest.Mock<Promise<Article>, [Article]>;
    create: jest.Mock<Article, [Partial<Article>]>;
    update: jest.Mock<
      Promise<{ affected: number }>,
      [unknown, Partial<Article>]
    >;
    delete: jest.Mock<Promise<{ affected: number }>, [string]>;
    countBy: jest.Mock<Promise<number>, [unknown]>;
    createQueryBuilder: jest.Mock<ConstructeurFactice, [string]>;
  };
  let diffuser: jest.Mock;
  let conditions: string[];

  const article = (surcharge: Partial<Article> = {}): Article =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      titre: 'Retour sur le gala',
      slug: 'retour-sur-le-gala',
      contenu: 'Un long compte rendu.',
      extrait: 'Un long compte rendu.',
      statut: StatutArticle.PUBLIE,
      publishedAt: HIER,
      annonceLe: HIER,
      ...surcharge,
    }) as Article;

  /** Constructeur de requête chaînable, qui retient les conditions posées. */
  const constructeur = (): ConstructeurFactice => {
    const faux: ConstructeurFactice = {
      leftJoinAndSelect: jest.fn(),
      select: jest.fn(),
      groupBy: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawMany: jest.fn(),
    };

    // Chaînage rétabli après construction : une fonction fléchée renvoyant
    // `faux` depuis l'initialiseur se réfère à une variable pas encore liée.
    for (const cle of CHAINABLES) {
      faux[cle].mockReturnValue(faux);
    }
    faux.andWhere.mockImplementation((condition: string) => {
      conditions.push(condition);
      return faux;
    });
    faux.getManyAndCount.mockResolvedValue([[], 0]);
    faux.getRawMany.mockResolvedValue([]);

    return faux;
  };

  const stockage = { urlSignee: jest.fn().mockResolvedValue('https://cdn/x') };

  const nettoyage = {
    remplacer: jest.fn().mockResolvedValue(undefined),
    retirer: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    conditions = [];
    diffuser = jest.fn().mockResolvedValue(1);

    articles = {
      // Forme `jest.fn<Retour, Arguments>()` : elle donne au mock son type sans
      // exiger une implémentation dont les paramètres resteraient inutilisés.
      // Une implémentation d'arité nulle n'est pas assignable à un mock déclaré
      // avec ses arguments — le compilateur le refuse, pas seulement le linteur.
      findOne: jest
        .fn<Promise<Article | null>, [unknown]>()
        .mockResolvedValue(article()),
      find: jest.fn<Promise<Article[]>, [unknown]>().mockResolvedValue([]),
      save: jest.fn((entite: Article) => Promise.resolve(entite)),
      create: jest.fn((entite: Partial<Article>) => entite as Article),
      update: jest
        .fn<Promise<{ affected: number }>, [unknown, Partial<Article>]>()
        .mockResolvedValue({ affected: 1 }),
      delete: jest
        .fn<Promise<{ affected: number }>, [string]>()
        .mockResolvedValue({ affected: 1 }),
      countBy: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      createQueryBuilder: jest
        .fn<ConstructeurFactice, [string]>()
        .mockImplementation(() => constructeur()),
    };

    service = new ArticleService(
      articles as unknown as Repository<Article>,
      { diffuser } as unknown as NotificationService,
      nettoyage as unknown as NettoyageFichiers,
      stockage as unknown as Stockage,
    );
  });

  describe('visibilité', () => {
    it('cache un brouillon au public', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.BROUILLON, publishedAt: null }),
      );

      await expect(service.trouver('un-id')).rejects.toThrow(NotFoundException);
    });

    it('montre le brouillon à l’administration', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.BROUILLON, publishedAt: null }),
      );

      await expect(
        service.trouver('un-id', { role: Role.ADMIN }),
      ).resolves.toMatchObject({ statut: StatutArticle.BROUILLON });
    });

    it('cache un article programmé dont l’heure n’est pas venue', async () => {
      // Le statut seul ne suffit pas : un article programmé porte « PUBLIE »
      // avec une date à venir.
      articles.findOne.mockResolvedValue(article({ publishedAt: DEMAIN }));

      await expect(service.trouverParSlug('un-slug')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('répond comme pour un inconnu, sans révéler le titre', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.BROUILLON }),
      );

      await expect(service.trouver('un-id')).rejects.toThrow(
        "Cet article n'existe pas.",
      );
    });

    it('restreint la liste publique aux articles parus', async () => {
      await service.lister(new FiltreArticleDto());

      expect(conditions).toEqual(
        expect.arrayContaining([
          'a.statut = :publie',
          'a.published_at IS NOT NULL',
          'a.published_at <= :maintenant',
        ]),
      );
    });

    it('n’impose pas cette restriction à l’administration', async () => {
      await service.lister(new FiltreArticleDto(), { role: Role.ADMIN });

      expect(conditions).not.toContain('a.published_at <= :maintenant');
    });

    it('ignore le statut demandé par un non-administrateur', async () => {
      // Sans cela, `?statut=BROUILLON` rendrait tout brouillon lisible.
      const filtre = new FiltreArticleDto();
      filtre.statut = StatutArticle.BROUILLON;

      await service.lister(filtre);

      expect(conditions).toContain('a.statut = :publie');
      expect(conditions).not.toContain('a.statut = :statut');
    });
  });

  describe('rédaction', () => {
    it('crée en brouillon, avec un slug tiré du titre', async () => {
      await service.creer(
        { titre: 'Rétrospective du mandat', contenu: 'Le contenu complet.' },
        'auteur-id',
      );

      expect(articles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'retrospective-du-mandat',
          statut: StatutArticle.BROUILLON,
          publishedAt: null,
          auteur: { id: 'auteur-id' },
        }),
      );
    });

    it('déduit l’extrait du contenu, coupé sur un mot', async () => {
      const contenu = `${'phrase de remplissage '.repeat(20)}fin`;

      await service.creer({ titre: 'Titre', contenu }, 'auteur-id');

      const extrait = articles.create.mock.calls[0][0].extrait ?? '';
      const corps = extrait.replace(/…$/, '');

      expect(extrait).toMatch(/…$/);
      expect(extrait.length).toBeLessThanOrEqual(201);
      // La coupe tombe sur une frontière de mot : le caractère qui suit dans le
      // contenu est un espace, donc aucun mot n'a été tronqué au milieu.
      expect(contenu.startsWith(corps)).toBe(true);
      expect(contenu[corps.length]).toBe(' ');
    });

    it('respecte un extrait fourni', async () => {
      await service.creer(
        { titre: 'Titre', contenu: 'Contenu long.', extrait: 'Mon accroche.' },
        'auteur-id',
      );

      expect(articles.create).toHaveBeenCalledWith(
        expect.objectContaining({ extrait: 'Mon accroche.' }),
      );
    });

    it('ne touche pas au slug quand le titre est corrigé', async () => {
      // Une adresse déjà partagée doit continuer de fonctionner.
      await service.mettreAJour('un-id', { titre: 'Titre corrigé' });

      const [cible, modifications] = articles.update.mock.calls[0];

      expect(cible).toBe('un-id');
      expect(modifications).not.toHaveProperty('slug');
      expect(modifications).toHaveProperty('titre', 'Titre corrigé');
    });

    it('efface l’ancienne couverture quand elle est remplacée', async () => {
      // Sans cela, corriger dix fois le visuel d'un article laisse dix objets
      // payants que plus rien ne référence.
      articles.findOne.mockResolvedValue(
        article({ imageCouverture: 'articles/avant.png' }),
      );

      await service.mettreAJour('un-id', {
        imageCouverture: 'articles/apres.png',
      });

      expect(nettoyage.remplacer).toHaveBeenCalledWith(
        'articles/avant.png',
        'articles/apres.png',
      );
    });

    it('ne touche pas à la couverture absente de la demande', async () => {
      articles.findOne.mockResolvedValue(
        article({ imageCouverture: 'articles/avant.png' }),
      );

      await service.mettreAJour('un-id', { titre: 'Titre corrigé' });

      expect(nettoyage.remplacer).toHaveBeenCalledWith(
        'articles/avant.png',
        undefined,
      );
    });
  });

  describe('parution', () => {
    it('annonce une parution immédiate', async () => {
      articles.findOne.mockResolvedValue(
        article({
          statut: StatutArticle.BROUILLON,
          publishedAt: null,
          annonceLe: null,
        }),
      );

      await service.publier('un-id');

      expect(diffuser).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ARTICLE',
          lien: '/actualites/retour-sur-le-gala',
        }),
      );
    });

    it('n’annonce pas une parution programmée', async () => {
      articles.findOne.mockResolvedValue(
        article({
          statut: StatutArticle.BROUILLON,
          publishedAt: null,
          annonceLe: null,
        }),
      );

      await service.publier('un-id', DEMAIN.toISOString());

      expect(diffuser).not.toHaveBeenCalled();
      expect(articles.update).toHaveBeenCalledWith(
        'un-id',
        expect.objectContaining({ statut: StatutArticle.PUBLIE }),
      );
    });

    it('ne renotifie pas un article déjà paru', async () => {
      // Une correction de faute de frappe ne doit pas alerter la promotion.
      await service.publier('un-id');

      expect(diffuser).not.toHaveBeenCalled();
      expect(articles.update).not.toHaveBeenCalled();
    });

    it('refuse de republier un article archivé', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.ARCHIVE }),
      );

      await expect(service.publier('un-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse une date de parution invalide', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.BROUILLON, publishedAt: null }),
      );

      await expect(service.publier('un-id', 'pas-une-date')).rejects.toThrow(
        'La date de parution est invalide.',
      );
    });
  });

  describe('tâche des parutions programmées', () => {
    it('annonce les articles dus', async () => {
      articles.find.mockResolvedValue([article({ annonceLe: null })]);

      await expect(service.diffuserLesParutionsDues()).resolves.toBe(1);
      expect(diffuser).toHaveBeenCalledTimes(1);
    });

    it('ne réannonce pas ce qui est déjà annoncé', async () => {
      // La marque est posée en base sous condition : un second passage — ou une
      // seconde instance — ne doit pas réveiller la promotion.
      articles.find.mockResolvedValue([article({ annonceLe: null })]);
      articles.update.mockResolvedValue({ affected: 0 });

      await service.diffuserLesParutionsDues();

      expect(diffuser).not.toHaveBeenCalled();
    });

    it('ne fait rien quand rien n’est dû', async () => {
      await expect(service.diffuserLesParutionsDues()).resolves.toBe(0);
      expect(diffuser).not.toHaveBeenCalled();
    });
  });

  describe('suppression', () => {
    it('refuse de supprimer un article paru', async () => {
      await expect(service.supprimer('un-id')).rejects.toThrow(
        'archivez-le plutôt que de le supprimer',
      );
      expect(articles.delete).not.toHaveBeenCalled();
    });

    it('supprime un brouillon', async () => {
      articles.findOne.mockResolvedValue(
        article({ statut: StatutArticle.BROUILLON }),
      );

      await service.supprimer('un-id');

      expect(articles.delete).toHaveBeenCalledWith('un-id');
    });

    it('emporte la couverture avec le brouillon', async () => {
      articles.findOne.mockResolvedValue(
        article({
          statut: StatutArticle.BROUILLON,
          imageCouverture: 'articles/couverture.png',
        }),
      );

      await service.supprimer('un-id');

      expect(nettoyage.retirer).toHaveBeenCalledWith(
        'articles/couverture.png',
        undefined,
      );
    });

    it('emporte aussi la vidéo de couverture et les médias du texte', async () => {
      articles.findOne.mockResolvedValue(
        article({
          statut: StatutArticle.BROUILLON,
          couvertureVideo: 'videos/recap.mp4',
          contenu: 'Photos : ![a](articles/a.png) et ![b](videos/b.mp4)',
        }),
      );

      await service.supprimer('un-id');

      expect(nettoyage.retirer).toHaveBeenCalledWith(
        undefined,
        'videos/recap.mp4',
        'articles/a.png',
        'videos/b.mp4',
      );
    });
  });

  describe('médias du texte', () => {
    it('retire du stockage un média que le texte ne cite plus', async () => {
      articles.findOne.mockResolvedValue(
        article({ contenu: '![a](articles/a.png) ![b](articles/b.png)' }),
      );

      await service.mettreAJour('un-id', {
        contenu: '![b](articles/b.png) fin',
      });

      expect(nettoyage.retirer).toHaveBeenCalledWith('articles/a.png');
    });

    it('ne touche à rien quand le texte n’est pas modifié', async () => {
      articles.findOne.mockResolvedValue(
        article({ contenu: '![a](articles/a.png)' }),
      );
      nettoyage.retirer.mockClear();

      await service.mettreAJour('un-id', { titre: 'Un autre titre' });

      expect(nettoyage.retirer).not.toHaveBeenCalled();
    });

    it('garde un média qui sert aussi de couverture', async () => {
      articles.findOne.mockResolvedValue(
        article({
          imageCouverture: 'articles/a.png',
          contenu: '![a](articles/a.png)',
        }),
      );
      nettoyage.retirer.mockClear();

      await service.mettreAJour('un-id', { contenu: 'Plus de média ici.' });

      expect(nettoyage.retirer).not.toHaveBeenCalled();
    });

    it('remplace la vidéo de couverture', async () => {
      articles.findOne.mockResolvedValue(
        article({ couvertureVideo: 'videos/avant.mp4' }),
      );

      await service.mettreAJour('un-id', {
        couvertureVideo: 'videos/apres.mp4',
      });

      expect(nettoyage.remplacer).toHaveBeenCalledWith(
        'videos/avant.mp4',
        'videos/apres.mp4',
      );
    });
  });

  describe('catégories', () => {
    it('reprend l’orthographe d’une catégorie déjà utilisée', async () => {
      const faux = constructeur();
      faux.getRawMany.mockResolvedValue([{ categorie: 'Vie du campus' }]);
      articles.createQueryBuilder.mockReturnValue(faux);

      await service.creer(
        {
          titre: 'Un titre',
          contenu: 'Un contenu assez long.',
          categorie: 'vie du  CAMPUS ',
        },
        'auteur-1',
      );

      expect(articles.create).toHaveBeenCalledWith(
        expect.objectContaining({ categorie: 'Vie du campus' }),
      );
    });

    it('met une majuscule à une catégorie nouvelle', async () => {
      await service.creer(
        {
          titre: 'Un titre',
          contenu: 'Un contenu assez long.',
          categorie: 'sport',
        },
        'auteur-1',
      );

      expect(articles.create).toHaveBeenCalledWith(
        expect.objectContaining({ categorie: 'Sport' }),
      );
    });

    it('ne compte qu’une fois une catégorie écrite de deux façons', async () => {
      const faux = constructeur();
      faux.getRawMany.mockResolvedValue([{ categorie: 'Sport' }]);
      articles.createQueryBuilder.mockReturnValue(faux);

      await expect(service.categories()).resolves.toEqual(['Sport']);
      expect(faux.groupBy).toHaveBeenCalledWith('LOWER(a.categorie)');
    });

    it('filtre sans égard à la casse', async () => {
      await service.lister({ categorie: 'sport' } as FiltreArticleDto);

      expect(conditions).toContain('LOWER(a.categorie) = LOWER(:categorie)');
    });
  });

  describe('audience de l’annonce', () => {
    const publier = (surcharge: Partial<Article>) => {
      articles.findOne.mockResolvedValue(
        article({
          statut: StatutArticle.BROUILLON,
          publishedAt: null,
          annonceLe: null,
          ...surcharge,
        }),
      );
      return service.publier('un-id');
    };

    it('annonce à tous par défaut', async () => {
      await publier({ audience: AudienceArticle.TOUS });

      expect(diffuser).toHaveBeenCalledWith(
        expect.not.objectContaining({ finissantsSeulement: true }),
      );
    });

    it('cible les finissants', async () => {
      await publier({ audience: AudienceArticle.FINISSANTS });

      expect(diffuser).toHaveBeenCalledWith(
        expect.objectContaining({ finissantsSeulement: true }),
      );
    });

    it('cible une promotion', async () => {
      await publier({
        audience: AudienceArticle.PROMOTION,
        audiencePromotion: 2027,
      });

      expect(diffuser).toHaveBeenCalledWith(
        expect.objectContaining({ promotion: 2027 }),
      );
    });

    it('fait paraître sans rien annoncer', async () => {
      await publier({ audience: AudienceArticle.AUCUNE });

      expect(diffuser).not.toHaveBeenCalled();
    });

    it('exige la promotion visée pour une annonce ciblée', async () => {
      await expect(
        service.creer(
          {
            titre: 'Un titre',
            contenu: 'Un contenu assez long.',
            audience: AudienceArticle.PROMOTION,
          },
          'auteur-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('consultations et aperçu', () => {
    /** Constructeur de mise à jour, qui rend `affected` lignes touchées. */
    const miseAJour = (affected: number) => {
      const faux = {
        update: jest.fn(),
        set: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      faux.update.mockReturnValue(faux);
      faux.set.mockReturnValue(faux);
      faux.where.mockReturnValue(faux);
      faux.andWhere.mockReturnValue(faux);
      return faux;
    };

    it('compte une consultation d’un article paru', async () => {
      const faux = miseAJour(1);
      articles.createQueryBuilder.mockReturnValue(
        faux as unknown as ConstructeurFactice,
      );

      await expect(service.enregistrerVue('un-id')).resolves.toBeUndefined();
      expect(faux.set).toHaveBeenCalledWith({
        vues: expect.any(Function) as unknown,
      });
    });

    it('ne compte pas un article non paru', async () => {
      articles.createQueryBuilder.mockReturnValue(
        miseAJour(0) as unknown as ConstructeurFactice,
      );

      await expect(service.enregistrerVue('un-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('donne une adresse stable à la couverture', async () => {
      articles.findOne.mockResolvedValue(
        article({ imageCouverture: 'articles/c.png' }),
      );

      await expect(service.urlCouverture('un-slug')).resolves.toBe(
        'https://cdn/x',
      );
    });

    it('rend null pour un article sans image', async () => {
      articles.findOne.mockResolvedValue(article({ imageCouverture: null }));

      await expect(service.urlCouverture('un-slug')).resolves.toBeNull();
    });
  });
});
