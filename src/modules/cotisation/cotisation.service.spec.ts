import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GenerationService } from '../generation/generation.service';
import { User } from '../user/entities/user.entity';
import { CotisationService } from './cotisation.service';
import {
  CibleCotisation,
  Cotisation,
  StatutCotisation,
} from './entities/cotisation.entity';
import {
  ParticipationCotisation,
  StatutParticipation,
} from './entities/participation-cotisation.entity';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { VersementFinance } from './entities/versement-finance.entity';

/**
 * Ce que le banc de bout en bout ne couvre pas.
 *
 * Deux points valent une attention particulière : le **règlement incrémenté en
 * base** plutôt que lu puis réécrit — deux paiements simultanés s'écraseraient
 * sinon — et la **traduction des populations**, où confondre un rôle avec un
 * statut ferait cotiser les mauvaises personnes.
 */
describe('CotisationService', () => {
  let service: CotisationService;
  let cotisations: Record<string, jest.Mock>;
  let participations: Record<string, jest.Mock>;
  let versements: Record<string, jest.Mock>;
  let constructeur: Record<string, jest.Mock>;
  let trouverActive: jest.Mock;

  const cotisation = (surcharge: Partial<Cotisation> = {}): Cotisation =>
    ({
      id: 'c1',
      titre: 'Cotisation',
      montantTotal: 30_000,
      cibles: [CibleCotisation.FINISSANT],
      statut: StatutCotisation.BROUILLON,
      tranches: [],
      ...surcharge,
    }) as Cotisation;

  beforeEach(() => {
    constructeur = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    cotisations = {
      findOne: jest.fn().mockResolvedValue(cotisation()),
      save: jest
        .fn()
        .mockImplementation((c: Cotisation) => ({ ...c, id: 'c1' })),
      create: jest.fn().mockImplementation((c: Partial<Cotisation>) => c),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    participations = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
      save: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((p: unknown) => p),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    versements = {
      save: jest.fn().mockImplementation((v: unknown) => v),
      create: jest.fn().mockImplementation((v: unknown) => v),
      find: jest.fn().mockResolvedValue([]),
    };
    trouverActive = jest.fn().mockResolvedValue({ annee: 2027 });

    service = new CotisationService(
      cotisations as unknown as Repository<Cotisation>,
      {
        delete: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
      } as unknown as Repository<TrancheCotisation>,
      participations as unknown as Repository<ParticipationCotisation>,
      versements as unknown as Repository<VersementFinance>,
      {
        createQueryBuilder: jest.fn().mockReturnValue(constructeur),
        findOne: jest.fn().mockResolvedValue({ id: 'u1' }),
      } as unknown as Repository<User>,
      { trouverActive } as unknown as GenerationService,
    );
  });

  describe('échéancier', () => {
    const creer = (tranches: { ordre: number; montant: number }[]) =>
      service.creer({
        titre: 'Cotisation',
        montantTotal: 30_000,
        cibles: [CibleCotisation.FINISSANT],
        tranches: tranches.map((t) => ({
          ...t,
          libelle: `T${t.ordre}`,
          dateLimite: '2099-01-01T00:00:00.000Z',
        })),
      });

    it('refuse un total qui ne correspond pas', async () => {
      await expect(creer([{ ordre: 1, montant: 5_000 }])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse deux tranches de même rang', async () => {
      // Leur consommation serait indéterminée.
      await expect(
        creer([
          { ordre: 1, montant: 15_000 },
          { ordre: 1, montant: 15_000 },
        ]),
      ).rejects.toThrow(/même ordre/);
    });

    it('accepte un échéancier exact', async () => {
      await expect(
        creer([
          { ordre: 1, montant: 10_000 },
          { ordre: 2, montant: 20_000 },
        ]),
      ).resolves.toBeDefined();
    });
  });

  describe('règlement', () => {
    it('incrémente en base plutôt que de lire puis écrire', async () => {
      // Un paiement en ligne et la validation d'un justificatif peuvent
      // survenir en même temps : les lire tous deux avant d'écrire ferait
      // perdre le premier.
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 10_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 10_000);

      expect(participations.increment).toHaveBeenCalledWith(
        { id: 'p1' },
        'montantRegle',
        10_000,
      );
    });

    it('solde la participation une fois le dû atteint', async () => {
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 30_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 20_000);

      expect(participations.update).toHaveBeenCalledWith('p1', {
        statut: StatutParticipation.SOLDEE,
      });
    });

    it('ne solde pas tant qu’il reste à verser', async () => {
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 10_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 10_000);

      expect(participations.update).not.toHaveBeenCalled();
    });

    it('ignore une participation inconnue sans lever', async () => {
      // Le webhook ne doit pas échouer sur une référence disparue : il
      // renverrait une erreur au prestataire, qui rejouerait indéfiniment.
      await expect(
        service.enregistrerReglement('inconnue', 5_000),
      ).resolves.toBeUndefined();
      expect(participations.increment).not.toHaveBeenCalled();
    });
  });

  describe('cycle de vie', () => {
    it('refuse de modifier une cotisation ouverte', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.OUVERTE }),
      );

      await expect(
        service.mettreAJour('c1', { montantTotal: 50_000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse d’ouvrir une cotisation close', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.CLOSE }),
      );

      await expect(service.ouvrir('c1')).rejects.toThrow(ConflictException);
    });

    it('refuse d’ouvrir sans population visée', async () => {
      cotisations.findOne.mockResolvedValue(cotisation({ cibles: [] }));

      await expect(service.ouvrir('c1')).rejects.toThrow(BadRequestException);
    });

    it('refuse de supprimer une cotisation ouverte', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.OUVERTE }),
      );

      await expect(service.supprimer('c1')).rejects.toThrow(ConflictException);
    });

    it('supprime un brouillon', async () => {
      await service.supprimer('c1');

      expect(cotisations.delete).toHaveBeenCalledWith('c1');
    });
  });

  describe('populations visées', () => {
    const ouvrirAvec = async (cibles: CibleCotisation[]) => {
      cotisations.findOne.mockResolvedValue(cotisation({ cibles }));
      await service.ouvrir('c1');
      return (constructeur.andWhere.mock.calls[0] ?? []) as [
        string,
        Record<string, unknown>,
      ];
    };

    it('reconnaît le finissant à son statut, non à son rôle', async () => {
      // « Finissant » est calculé depuis la promotion et le mandat : le
      // confondre avec STUDENT ferait cotiser toute l'école.
      const [condition] = await ouvrirAvec([CibleCotisation.FINISSANT]);

      expect(condition).toContain('is_finissant');
    });

    it('cumule plusieurs cibles', async () => {
      const [condition] = await ouvrirAvec([
        CibleCotisation.ETUDIANT,
        CibleCotisation.VISITEUR,
      ]);

      expect(condition).toContain(' OR ');
    });

    it('situe l’alumni par rapport au mandat en cours', async () => {
      const [condition, parametres] = await ouvrirAvec([
        CibleCotisation.ALUMNI,
      ]);

      expect(condition).toContain('promotion <');
      expect(parametres).toMatchObject({ annee: 2027 });
    });

    it('ignore la cible alumni sans mandat actif', async () => {
      // La notion n'a alors aucun repère : la deviner ferait cotiser des gens
      // au hasard.
      trouverActive.mockResolvedValue(null);
      cotisations.findOne.mockResolvedValue(
        cotisation({ cibles: [CibleCotisation.ALUMNI] }),
      );

      await service.ouvrir('c1');

      expect(constructeur.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('encaisse', () => {
    it('refuse une remise nulle ou négative', async () => {
      await expect(
        service.declarerVersement({ id: 'u1' } as User, { montant: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enregistre une remise sans destinataire désigné', async () => {
      await expect(
        service.declarerVersement({ id: 'u1' } as User, { montant: 50_000 }),
      ).resolves.toMatchObject({ montant: 50_000, recuPar: null });
    });
  });
});
