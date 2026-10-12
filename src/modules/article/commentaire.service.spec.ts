import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { PaginationDto } from '../../common/pagination';
import { CommentaireService } from './commentaire.service';
import { Article, StatutArticle } from './entities/article.entity';
import { CommentaireArticle } from './entities/commentaire-article.entity';

describe('CommentaireService', () => {
  let service: CommentaireService;
  let article: Partial<Article> | null;
  let commentaire: Partial<CommentaireArticle> | null;
  let recents: number;
  let commentaires: Record<string, jest.Mock>;

  const auteur = {
    id: 'u1',
    firstName: 'Awa',
    lastName: 'Ngassa',
    avatar: null,
  };
  const pagination = Object.assign(new PaginationDto(), {
    page: 1,
    limite: 20,
  });

  beforeEach(() => {
    article = {
      id: 'a1',
      statut: StatutArticle.PUBLIE,
      publishedAt: new Date(Date.now() - 1000),
      commentairesActifs: true,
    };
    commentaire = {
      id: 'c1',
      contenu: 'Bravo',
      masque: false,
      createdAt: new Date(),
      auteur: auteur as never,
    };
    recents = 0;

    commentaires = {
      findAndCount: jest.fn(() => Promise.resolve([[commentaire], 1])),
      findOne: jest.fn(() => Promise.resolve(commentaire)),
      countBy: jest.fn(() => Promise.resolve(recents)),
      create: jest.fn((c: unknown) => c),
      save: jest.fn(() => Promise.resolve({ id: 'c1' })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    service = new CommentaireService(
      commentaires as unknown as Repository<CommentaireArticle>,
      {
        findOneBy: jest.fn(() => Promise.resolve(article)),
      } as unknown as Repository<Article>,
    );
  });

  it('liste les commentaires sans exposer l’email de l’auteur', async () => {
    const page = await service.lister('a1', pagination);

    expect(page.donnees[0]).toEqual({
      id: 'c1',
      contenu: 'Bravo',
      masque: false,
      createdAt: commentaire?.createdAt,
      auteur: { id: 'u1', prenom: 'Awa', nom: 'Ngassa', avatar: null },
    });
  });

  it('cache les commentaires masqués au public, pas à l’administration', async () => {
    await service.lister('a1', pagination);
    expect(commentaires.findAndCount).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ masque: false }) as unknown,
      }),
    );

    await service.lister('a1', pagination, { role: Role.ADMIN });
    expect(commentaires.findAndCount).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ masque: false }) as unknown,
      }),
    );
  });

  it('ne montre pas les commentaires d’un brouillon', async () => {
    article = { ...article, statut: StatutArticle.BROUILLON };

    await expect(service.lister('a1', pagination)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('publie un commentaire', async () => {
    const cree = await service.publier('u1', 'a1', 'Bravo');

    expect(cree.contenu).toBe('Bravo');
    expect(commentaires.save).toHaveBeenCalled();
  });

  it('refuse quand les commentaires sont fermés', async () => {
    article = { ...article, commentairesActifs: false };

    await expect(service.publier('u1', 'a1', 'Bravo')).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuse de commenter trop vite', async () => {
    recents = 1;

    await expect(service.publier('u1', 'a1', 'Bravo')).rejects.toThrow(
      HttpException,
    );
    expect(commentaires.save).not.toHaveBeenCalled();
  });

  it('refuse de commenter un article inconnu', async () => {
    article = null;

    await expect(service.publier('u1', 'a1', 'Bravo')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('laisse l’auteur supprimer son commentaire', async () => {
    await service.supprimer('c1', { id: 'u1', role: Role.STUDENT });

    expect(commentaires.delete).toHaveBeenCalledWith('c1');
  });

  it('laisse l’administration supprimer celui d’un autre', async () => {
    await service.supprimer('c1', { id: 'u9', role: Role.ADMIN });

    expect(commentaires.delete).toHaveBeenCalledWith('c1');
  });

  it('refuse qu’un tiers supprime le commentaire d’un autre', async () => {
    await expect(
      service.supprimer('c1', { id: 'u9', role: Role.STUDENT }),
    ).rejects.toThrow(ForbiddenException);
    expect(commentaires.delete).not.toHaveBeenCalled();
  });

  it('masque sans effacer', async () => {
    await service.masquer('c1', true);

    expect(commentaires.update).toHaveBeenCalledWith('c1', { masque: true });
    expect(commentaires.delete).not.toHaveBeenCalled();
  });

  it('refuse de modérer un commentaire inconnu', async () => {
    commentaire = null;

    await expect(service.masquer('c1', true)).rejects.toThrow(
      NotFoundException,
    );
  });
});
