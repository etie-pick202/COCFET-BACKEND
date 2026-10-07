import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Generation } from '../generation/entities/generation.entity';
import { MailService } from '../mail/mail.service';
import { User } from '../user/entities/user.entity';
import { BureauService } from './bureau.service';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';
import { PreferenceEmailService } from '../notification/preference-email.service';

/**
 * Concentré sur la désignation d'un membre : c'est le geste qui déclenche
 * l'accueil par email, et le seul dont l'échec silencieux se remarquerait
 * seulement le jour où quelqu'un demanderait pourquoi il n'a rien reçu.
 */
describe('BureauService — désignation', () => {
  let service: BureauService;
  let envoyerBienvenueAuBureau: jest.Mock;
  let postes: { findOne: jest.Mock };
  let membres: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let generations: { findOne: jest.Mock };
  let users: { findOne: jest.Mock };

  const generation = (surcharge: Partial<Generation> = {}): Generation =>
    ({
      id: 'generation-id',
      nom: 'ATLAS',
      annee: 2027,
      archivedAt: null,
      ...surcharge,
    }) as Generation;

  const poste = (surcharge: Partial<PosteBureau> = {}): PosteBureau =>
    ({
      id: 'poste-id',
      nom: 'Trésorière',
      description: 'Tient les comptes du mandat.',
      accordeAdministration: false,
      ...surcharge,
    }) as PosteBureau;

  const user = (surcharge: Partial<User> = {}): User =>
    ({
      id: 'user-id',
      email: 'awa@2027.ucac-icam.com',
      firstName: 'Awa',
      promotion: 2027,
      emailVerifieLe: new Date(),
      ...surcharge,
    }) as User;

  const affectation = { posteId: 'poste-id', userId: 'user-id' };

  const preferenceEmail = { autorise: jest.fn().mockResolvedValue(true) };

  beforeEach(() => {
    envoyerBienvenueAuBureau = jest.fn(() => Promise.resolve());
    preferenceEmail.autorise.mockResolvedValue(true);

    postes = { findOne: jest.fn(() => Promise.resolve(poste())) };
    generations = { findOne: jest.fn(() => Promise.resolve(generation())) };
    users = { findOne: jest.fn(() => Promise.resolve(user())) };
    membres = {
      // Aucun titulaire en place pour ce poste.
      findOne: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((entite: Partial<MembreBureau>) => entite),
      save: jest.fn((entite: MembreBureau) =>
        Promise.resolve({ ...entite, id: 'membre-id' }),
      ),
    };

    service = new BureauService(
      postes as unknown as Repository<PosteBureau>,
      membres as unknown as Repository<MembreBureau>,
      generations as unknown as Repository<Generation>,
      users as unknown as Repository<User>,
      { envoyerBienvenueAuBureau } as unknown as MailService,
      preferenceEmail as unknown as PreferenceEmailService,
    );
  });

  it('accueille le membre en nommant son poste et son mandat', async () => {
    await service.affecter('generation-id', affectation);

    expect(envoyerBienvenueAuBureau).toHaveBeenCalledWith(
      'awa@2027.ucac-icam.com',
      'Awa',
      expect.objectContaining({
        poste: 'Trésorière',
        mandat: 'ATLAS',
        annee: 2027,
        mission: 'Tient les comptes du mandat.',
      }),
    );
  });

  it('signale les postes qui ouvrent l’administration', async () => {
    // Sans cette mention, la personne se connecte, ne voit rien de nouveau, et
    // conclut à une panne : ses droits n'arrivent qu'à l'activation du mandat.
    postes.findOne.mockResolvedValue(poste({ accordeAdministration: true }));

    await service.affecter('generation-id', affectation);

    expect(envoyerBienvenueAuBureau).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ administration: true }),
    );
  });

  it('n’envoie rien quand la désignation est refusée', async () => {
    // Un compte d'une autre promotion ne siège pas : le message partirait
    // avant que la règle ne s'applique si l'ordre était inversé.
    users.findOne.mockResolvedValue(user({ promotion: 2026 }));

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow(BadRequestException);
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien à un compte dont l’adresse n’est pas confirmée', async () => {
    users.findOne.mockResolvedValue(user({ emailVerifieLe: null }));

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow('n’a pas confirmé son adresse');
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien quand le poste est déjà occupé', async () => {
    membres.findOne.mockResolvedValue({ id: 'deja-la' });

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow(ConflictException);
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien sur un mandat archivé', async () => {
    generations.findOne.mockResolvedValue(
      generation({ archivedAt: new Date() }),
    );

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow('sa composition ne change plus');
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('respecte le refus des emails de service', async () => {
    // Un message de confort, pas une piece ni une alerte : couper doit
    // reellement couper, sans quoi le choix offert n'en serait pas un.
    preferenceEmail.autorise.mockResolvedValue(false);

    await service.affecter('g1', { posteId: 'p1', userId: 'u1' });

    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('enregistre la désignation avant d’annoncer quoi que ce soit', async () => {
    // L'ordre compte : un accueil parti sur une désignation qui n'a pas été
    // écrite annoncerait un poste que personne n'occupe.
    const ordre: string[] = [];
    membres.save.mockImplementation((entite: MembreBureau) => {
      ordre.push('enregistrement');
      return Promise.resolve({ ...entite, id: 'membre-id' });
    });
    envoyerBienvenueAuBureau.mockImplementation(() => {
      ordre.push('accueil');
      return Promise.resolve();
    });

    await service.affecter('generation-id', affectation);

    expect(ordre).toEqual(['enregistrement', 'accueil']);
  });
});

describe('BureauService — destinataires de la trésorerie', () => {
  let service: BureauService;
  let generations: { findOne: jest.Mock };
  let membres: { find: jest.Mock };
  let users: { find: jest.Mock };

  const compte = (id: string, actif = true): User =>
    ({ id, isActive: actif }) as User;

  beforeEach(() => {
    generations = {
      findOne: jest.fn(() => Promise.resolve({ id: 'mandat-2027' })),
    };
    membres = { find: jest.fn(() => Promise.resolve([])) };
    users = { find: jest.fn(() => Promise.resolve([])) };

    service = new BureauService(
      {} as unknown as Repository<PosteBureau>,
      membres as unknown as Repository<MembreBureau>,
      generations as unknown as Repository<Generation>,
      users as unknown as Repository<User>,
      {} as unknown as MailService,
      {} as unknown as PreferenceEmailService,
    );
  });

  it('réunit les postes de trésorerie du mandat en cours et l’exploitation', async () => {
    users.find.mockResolvedValue([compte('exploitant')]);
    membres.find.mockResolvedValue([{ user: compte('tresoriere') }]);

    const ids = (await service.destinatairesTresorerie()).map((u) => u.id);

    // L'ordre n'a pas d'importance : on compare des ensembles.
    expect(new Set(ids)).toEqual(new Set(['exploitant', 'tresoriere']));
  });

  it('ne cherche les membres que sur le mandat en cours et sur un poste de trésorerie', async () => {
    await service.destinatairesTresorerie();

    expect(membres.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          generation: { id: 'mandat-2027' },
          poste: { accedeTresorerie: true },
        },
      }),
    );
  });

  it('écarte les comptes désactivés', async () => {
    membres.find.mockResolvedValue([{ user: compte('parti', false) }]);

    expect(await service.destinatairesTresorerie()).toEqual([]);
  });

  it('ne compte une personne qu’une fois, même titulaire de deux postes', async () => {
    users.find.mockResolvedValue([compte('exploitant')]);
    membres.find.mockResolvedValue([
      { user: compte('exploitant') },
      { user: compte('exploitant') },
    ]);

    expect(await service.destinatairesTresorerie()).toHaveLength(1);
  });

  it('prévient quand même l’exploitation sans mandat en cours', async () => {
    generations.findOne.mockResolvedValue(null);
    users.find.mockResolvedValue([compte('exploitant')]);

    const ids = (await service.destinatairesTresorerie()).map((u) => u.id);

    expect(ids).toEqual(['exploitant']);
    expect(membres.find).not.toHaveBeenCalled();
  });
});

describe('BureauService — ma présentation', () => {
  let service: BureauService;
  let generations: { findOne: jest.Mock };
  let membres: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };

  const mandat = { id: 'mandat-2027', annee: 2027, nom: 'ATLAS' };

  const place = (surcharge: Partial<MembreBureau> = {}): MembreBureau =>
    ({
      id: 'place-1',
      presentation: null,
      generation: mandat,
      poste: { nom: 'Trésorière', ordre: 4 },
      user: {
        id: 'awa',
        firstName: 'Awa',
        lastName: 'Ngassa',
        avatar: 'cle.png',
      },
      ...surcharge,
    }) as unknown as MembreBureau;

  beforeEach(() => {
    generations = { findOne: jest.fn(() => Promise.resolve(mandat)) };
    membres = {
      find: jest.fn(() => Promise.resolve([place()])),
      findOne: jest.fn(() => Promise.resolve(place())),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    service = new BureauService(
      {} as unknown as Repository<PosteBureau>,
      membres as unknown as Repository<MembreBureau>,
      generations as unknown as Repository<Generation>,
      {} as unknown as Repository<User>,
      {} as unknown as MailService,
      {} as unknown as PreferenceEmailService,
    );
  });

  describe('mesPlaces', () => {
    it('rend de quoi dessiner la carte, mandat compris', async () => {
      const [ma] = await service.mesPlaces('awa');

      expect(ma).toMatchObject({
        id: 'place-1',
        poste: 'Trésorière',
        annee: 2027,
        mandat: 'ATLAS',
        prenom: 'Awa',
        nom: 'Ngassa',
        avatar: 'cle.png',
        presentation: null,
      });
      expect(ma.presentationMax).toBeGreaterThan(0);
    });

    it('ne cherche que sur le mandat en cours et pour cette personne', async () => {
      await service.mesPlaces('awa');

      expect(membres.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { generation: { id: 'mandat-2027' }, user: { id: 'awa' } },
        }),
      );
    });

    it('classe les cartes d’une personne cumulant deux postes dans l’ordre protocolaire', async () => {
      membres.find.mockResolvedValue([
        place({ id: 'b', poste: { nom: 'Trésorière', ordre: 4 } as never }),
        place({ id: 'a', poste: { nom: 'Présidente', ordre: 1 } as never }),
      ]);

      const places = await service.mesPlaces('awa');

      expect(places.map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('ne rend rien sans mandat en cours', async () => {
      generations.findOne.mockResolvedValue(null);

      expect(await service.mesPlaces('awa')).toEqual([]);
      expect(membres.find).not.toHaveBeenCalled();
    });
  });

  describe('modifierMaPresentation', () => {
    it('cherche la place avec son titulaire dans la condition, sur le mandat actif', async () => {
      await service.modifierMaPresentation('awa', 'place-1', 'Bonjour.');

      expect(membres.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'place-1',
            user: { id: 'awa' },
            generation: { isActive: true },
          },
        }),
      );
    });

    it('répond 404 pour la place d’un autre, sans rien écrire', async () => {
      membres.findOne.mockResolvedValue(null);

      await expect(
        service.modifierMaPresentation('intrus', 'place-1', 'Bonjour.'),
      ).rejects.toThrow(NotFoundException);
      expect(membres.update).not.toHaveBeenCalled();
    });

    it('enregistre la phrase et rend la carte mise à jour', async () => {
      const ma = await service.modifierMaPresentation(
        'awa',
        'place-1',
        'Servir la promotion.',
      );

      expect(membres.update).toHaveBeenCalledWith('place-1', {
        presentation: 'Servir la promotion.',
      });
      expect(ma.presentation).toBe('Servir la promotion.');
    });

    it.each([
      ['  trop   d’espaces  ', 'trop d’espaces'],
      ['sur\ndeux\n\nlignes', 'sur deux lignes'],
      ['\t\n  ', null],
      ['', null],
      [null, null],
    ])('remet %j au propre : %j', async (saisie, attendu) => {
      const ma = await service.modifierMaPresentation('awa', 'place-1', saisie);

      expect(membres.update).toHaveBeenCalledWith('place-1', {
        presentation: attendu,
      });
      expect(ma.presentation).toBe(attendu);
    });
  });
});
