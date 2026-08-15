import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { OptionSondage } from './entities/option-sondage.entity';
import { ParticipationSondage } from './entities/participation-sondage.entity';
import {
  Sondage,
  StatutSondage,
  TypeSondage,
  VisibiliteResultats,
} from './entities/sondage.entity';
import { Vote } from './entities/vote.entity';
import { SondageService } from './sondage.service';

const DEMAIN = new Date(Date.now() + 86_400_000);
const HIER = new Date(Date.now() - 86_400_000);

const OPTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ETRANGERE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENEMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Erreur postgres d'unicité, telle que la remonte le pilote. */
const violationUnicite = (): QueryFailedError => {
  const erreur = new QueryFailedError('INSERT', [], new Error('doublon'));
  (erreur as QueryFailedError & { code?: string }).code = '23505';
  return erreur;
};

describe('SondageService', () => {
  let service: SondageService;
  let sondages: {
    findOne: jest.Mock<Promise<Sondage | null>, [unknown]>;
    save: jest.Mock<Promise<Sondage>, [Sondage]>;
    create: jest.Mock<Sondage, [Partial<Sondage>]>;
    update: jest.Mock<Promise<{ affected: number }>, [unknown, unknown]>;
    delete: jest.Mock<Promise<{ affected: number }>, [string]>;
    createQueryBuilder: jest.Mock;
  };
  let votes: { find: jest.Mock };
  let participations: { existsBy: jest.Mock<Promise<boolean>, [unknown]> };
  let gestionnaire: {
    insert: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    increment: jest.Mock;
  };
  let diffuser: jest.Mock<Promise<number>, [Record<string, unknown>]>;

  const votant = (
    promotion: number | null = 2027,
  ): Pick<User, 'id' | 'promotion'> => ({
    id: '99999999-9999-4999-8999-999999999999',
    promotion,
  });

  const sondage = (surcharge: Partial<Sondage> = {}): Sondage =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      titre: 'Quel thème pour le gala ?',
      statut: StatutSondage.ACTIF,
      type: TypeSondage.CHOIX_UNIQUE,
      isAnonyme: false,
      campusUniquement: true,
      deadline: DEMAIN,
      visibiliteResultats: VisibiliteResultats.APRES_VOTE,
      totalVotes: 4,
      options: [
        { id: OPTION_A, texte: 'Années folles', votes: 3 } as OptionSondage,
        { id: OPTION_B, texte: 'Afrofuturisme', votes: 1 } as OptionSondage,
      ],
      ...surcharge,
    }) as Sondage;

  beforeEach(() => {
    diffuser = jest
      .fn<Promise<number>, [Record<string, unknown>]>()
      .mockResolvedValue(1);

    gestionnaire = {
      insert: jest.fn(() => Promise.resolve({})),
      save: jest.fn(() => Promise.resolve({ id: 'bulletin-id' })),
      create: jest.fn((_cible: unknown, donnees: unknown) => donnees),
      increment: jest.fn(() => Promise.resolve({})),
    };

    sondages = {
      // Forme `jest.fn<Retour, Arguments>()` : elle donne au mock son type sans
      // exiger une implémentation dont les paramètres resteraient inutilisés.
      findOne: jest
        .fn<Promise<Sondage | null>, [unknown]>()
        .mockResolvedValue(sondage()),
      save: jest.fn((entite: Sondage) => Promise.resolve(entite)),
      create: jest.fn((entite: Partial<Sondage>) => entite as Sondage),
      update: jest
        .fn<Promise<{ affected: number }>, [unknown, unknown]>()
        .mockResolvedValue({ affected: 1 }),
      delete: jest
        .fn<Promise<{ affected: number }>, [string]>()
        .mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    participations = {
      existsBy: jest.fn<Promise<boolean>, [unknown]>().mockResolvedValue(false),
    };

    // Depot des bulletins : seul le depouillement nominatif le consulte.
    votes = { find: jest.fn().mockResolvedValue([]) };

    service = new SondageService(
      sondages as unknown as Repository<Sondage>,
      participations as unknown as Repository<ParticipationSondage>,
      votes as unknown as Repository<Vote>,
      {
        transaction: (travail: (g: unknown) => Promise<unknown>) =>
          travail(gestionnaire),
      } as unknown as DataSource,
      { diffuser } as unknown as NotificationService,
    );
  });

  describe('visibilité du sondage', () => {
    it('cache un brouillon au public', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON }),
      );

      await expect(service.trouver('un-id')).rejects.toThrow(NotFoundException);
    });

    it('montre le brouillon à l’administration', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON }),
      );

      await expect(
        service.trouver('un-id', { role: Role.ADMIN }),
      ).resolves.toMatchObject({ statut: StatutSondage.BROUILLON });
    });
  });

  describe('vote', () => {
    it('enregistre participation, bulletin et compteurs en une transaction', async () => {
      await service.voter('un-id', votant(), [OPTION_A]);

      expect(gestionnaire.insert).toHaveBeenCalledWith(
        ParticipationSondage,
        expect.objectContaining({
          sondage: { id: sondage().id },
          user: { id: votant().id },
        }),
      );
      expect(gestionnaire.increment).toHaveBeenCalledWith(
        OptionSondage,
        expect.anything(),
        'votes',
        1,
      );
      expect(gestionnaire.increment).toHaveBeenCalledWith(
        Sondage,
        { id: sondage().id },
        'totalVotes',
        1,
      );
    });

    it('rattache le bulletin au votant sur un sondage nominatif', async () => {
      await service.voter('un-id', votant(), [OPTION_A]);

      expect(gestionnaire.create).toHaveBeenCalledWith(
        Vote,
        expect.objectContaining({ user: { id: votant().id } }),
      );
    });

    it('détache le bulletin du votant sur un sondage anonyme', async () => {
      // C'est toute la différence entre les deux modes : le lien n'existe pas
      // en base, il n'est pas seulement masqué à la lecture.
      sondages.findOne.mockResolvedValue(sondage({ isAnonyme: true }));

      await service.voter('un-id', votant(), [OPTION_A]);

      expect(gestionnaire.create).toHaveBeenCalledWith(
        Vote,
        expect.objectContaining({ user: null }),
      );
      // La participation, elle, reste nominative : c'est elle qui interdit le
      // second vote.
      expect(gestionnaire.insert).toHaveBeenCalledWith(
        ParticipationSondage,
        expect.objectContaining({ user: { id: votant().id } }),
      );
    });

    it('traduit la violation d’unicité en « déjà voté »', async () => {
      // Le double vote est arrêté en base, pas en mémoire : deux requêtes
      // simultanées passeraient toutes deux une vérification préalable.
      gestionnaire.insert.mockRejectedValue(violationUnicite());

      await expect(
        service.voter('un-id', votant(), [OPTION_A]),
      ).rejects.toThrow('Vous avez déjà voté à ce sondage.');
    });

    it('laisse remonter une panne qui n’est pas un doublon', async () => {
      gestionnaire.insert.mockRejectedValue(new Error('base injoignable'));

      await expect(
        service.voter('un-id', votant(), [OPTION_A]),
      ).rejects.toThrow('base injoignable');
    });

    it('refuse un sondage pas encore ouvert', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON }),
      );

      await expect(
        service.voter('un-id', votant(), [OPTION_A]),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse un sondage clos', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.CLOS }),
      );

      await expect(
        service.voter('un-id', votant(), [OPTION_A]),
      ).rejects.toThrow('Ce sondage est clos.');
    });

    it('refuse un vote après la date limite, même sans clôture manuelle', async () => {
      sondages.findOne.mockResolvedValue(sondage({ deadline: HIER }));

      await expect(
        service.voter('un-id', votant(), [OPTION_A]),
      ).rejects.toThrow('La date limite de ce sondage est passée.');
    });

    it('refuse un extérieur sur un sondage réservé au campus', async () => {
      await expect(
        service.voter('un-id', votant(null), [OPTION_A]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepte un membre du bureau, reconnu à sa promotion', async () => {
      // Le critère est la promotion, non le rôle : une administratrice est
      // étudiante du campus et doit pouvoir répondre.
      await expect(
        service.voter('un-id', votant(2027), [OPTION_A]),
      ).resolves.toBeDefined();
    });

    it('accepte un extérieur quand le sondage est ouvert à tous', async () => {
      sondages.findOne.mockResolvedValue(sondage({ campusUniquement: false }));

      await expect(
        service.voter('un-id', votant(null), [OPTION_A]),
      ).resolves.toBeDefined();
    });

    it('refuse une option étrangère au sondage', async () => {
      // Sans ce contrôle, le vote incrémenterait le compteur d'un autre sondage.
      await expect(
        service.voter('un-id', votant(), [ETRANGERE]),
      ).rejects.toThrow('n’appartient pas à ce sondage');
    });

    it('refuse deux réponses à un sondage à choix unique', async () => {
      await expect(
        service.voter('un-id', votant(), [OPTION_A, OPTION_B]),
      ).rejects.toThrow('qu’une seule réponse');
    });

    it('accepte deux réponses à un sondage à choix multiple', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ type: TypeSondage.CHOIX_MULTIPLE }),
      );

      await service.voter('un-id', votant(), [OPTION_A, OPTION_B]);

      expect(gestionnaire.increment).toHaveBeenCalledWith(
        OptionSondage,
        expect.anything(),
        'votes',
        1,
      );
    });
  });

  describe('dépouillement', () => {
    it('masque les décomptes avant le vote', async () => {
      participations.existsBy.mockResolvedValue(false);

      const resultats = await service.resultats('un-id', votant().id);

      expect(resultats.resultatsVisibles).toBe(false);
      // Nuls, et non omis : un champ absent se confondrait avec un zéro.
      expect(resultats.options.every((o) => o.votes === null)).toBe(true);
      expect(resultats.totalVotes).toBe(4);
    });

    it('révèle les décomptes après le vote', async () => {
      participations.existsBy.mockResolvedValue(true);

      const resultats = await service.resultats('un-id', votant().id);

      expect(resultats.resultatsVisibles).toBe(true);
      expect(resultats.options[0]).toMatchObject({ votes: 3, pourcentage: 75 });
    });

    it('révèle toujours les décomptes quand la visibilité l’autorise', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ visibiliteResultats: VisibiliteResultats.TOUJOURS }),
      );

      await expect(
        service.resultats('un-id', votant().id),
      ).resolves.toMatchObject({ resultatsVisibles: true });
    });

    it('attend la clôture quand la visibilité l’exige', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({
          visibiliteResultats: VisibiliteResultats.APRES_DEADLINE,
        }),
      );
      participations.existsBy.mockResolvedValue(true);

      await expect(
        service.resultats('un-id', votant().id),
      ).resolves.toMatchObject({ resultatsVisibles: false });
    });

    it('ouvre le dépouillement une fois la date limite passée', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({
          visibiliteResultats: VisibiliteResultats.APRES_DEADLINE,
          deadline: HIER,
        }),
      );

      await expect(
        service.resultats('un-id', votant().id),
      ).resolves.toMatchObject({ resultatsVisibles: true });
    });

    it('ne divise pas par zéro sur un sondage sans vote', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({
          totalVotes: 0,
          visibiliteResultats: VisibiliteResultats.TOUJOURS,
          options: [{ id: OPTION_A, texte: 'A', votes: 0 } as OptionSondage],
        }),
      );

      await expect(
        service.resultats('un-id', votant().id),
      ).resolves.toMatchObject({
        options: [expect.objectContaining({ pourcentage: 0 })],
      });
    });
  });

  describe('cycle de vie', () => {
    it('crée en brouillon, avec ses options', async () => {
      await service.creer({
        titre: 'Thème du gala',
        options: ['A', 'B'],
        deadline: DEMAIN.toISOString(),
      });

      expect(sondages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          statut: StatutSondage.BROUILLON,
          totalVotes: 0,
          options: [
            { texte: 'A', votes: 0 },
            { texte: 'B', votes: 0 },
          ],
        }),
      );
    });

    it('rattache le sondage à un événement quand il est fourni', async () => {
      await service.creer({
        titre: 'Thème du gala',
        options: ['A', 'B'],
        deadline: DEMAIN.toISOString(),
        evenementId: EVENEMENT,
      });

      expect(sondages.create).toHaveBeenCalledWith(
        expect.objectContaining({ evenement: { id: EVENEMENT } }),
      );
    });

    it('laisse le sondage sans événement quand aucun n’est fourni', async () => {
      await service.creer({
        titre: 'Thème du gala',
        options: ['A', 'B'],
        deadline: DEMAIN.toISOString(),
      });

      expect(sondages.create.mock.calls[0][0]).not.toHaveProperty('evenement');
    });

    it('détache le sondage de son événement sur un identifiant nul', async () => {
      // `null` détache, l'absence du champ laisse tel quel : les confondre
      // rendrait le détachement impossible.
      await service.mettreAJour('un-id', { evenementId: null });

      expect(sondages.update.mock.calls[0][1]).toMatchObject({
        evenement: null,
      });
    });

    it('ne touche pas au rattachement quand le champ est absent', async () => {
      await service.mettreAJour('un-id', { description: 'Autre chose' });

      expect(sondages.update.mock.calls[0][1]).not.toHaveProperty('evenement');
    });

    it('refuse une date limite invalide', async () => {
      await expect(
        service.creer({
          titre: 'Thème',
          options: ['A', 'B'],
          deadline: 'pas-une-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('annonce l’ouverture du vote', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON }),
      );

      await service.activer('un-id');

      expect(diffuser).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SONDAGE', roles: [Role.STUDENT] }),
      );
    });

    it('annonce à tous un sondage ouvert aux extérieurs', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON, campusUniquement: false }),
      );

      await service.activer('un-id');

      expect(diffuser.mock.calls[0][0]).not.toHaveProperty('roles');
    });

    it('ne renotifie pas un sondage déjà ouvert', async () => {
      // Une prolongation de la date limite ne doit pas réveiller la promotion.
      await service.activer('un-id');

      expect(diffuser).not.toHaveBeenCalled();
      expect(sondages.update).not.toHaveBeenCalled();
    });

    it('refuse d’ouvrir un sondage dont la date limite est passée', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON, deadline: HIER }),
      );

      await expect(service.activer('un-id')).rejects.toThrow(
        'prolongez-la avant d’ouvrir le vote',
      );
    });

    it('refuse de rouvrir un sondage clos', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.CLOS }),
      );

      await expect(service.activer('un-id')).rejects.toThrow(
        'invaliderait son dépouillement',
      );
    });

    it('refuse de supprimer un sondage qui compte des votes', async () => {
      await expect(service.supprimer('un-id')).rejects.toThrow(
        'clôturez-le plutôt que de le supprimer',
      );
      expect(sondages.delete).not.toHaveBeenCalled();
    });

    it('supprime un sondage sans vote', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.BROUILLON, totalVotes: 0 }),
      );

      await service.supprimer('un-id');

      expect(sondages.delete).toHaveBeenCalledWith('un-id');
    });

    it('refuse de retoucher un sondage clos', async () => {
      sondages.findOne.mockResolvedValue(
        sondage({ statut: StatutSondage.CLOS }),
      );

      await expect(
        service.mettreAJour('un-id', { description: 'Autre chose' }),
      ).rejects.toThrow('ne se retouche plus');
    });
  });
});
