import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Evenement } from '../evenement/entities/evenement.entity';
import { EvenementService } from '../evenement/evenement.service';
import { OptionEvenement } from '../evenement/options';
import { NotificationService } from '../notification/notification.service';
import { Inscription, StatutInscription } from './entities/inscription.entity';
import { OptionsEvenementService } from './options-evenement.service';

const DANS = (jours: number) => new Date(Date.now() + jours * 86_400_000);

const OPTIONS: OptionEvenement[] = [
  {
    cle: 'taille',
    libelle: 'Taille de T-shirt',
    obligatoire: true,
    choix: [
      { valeur: 'M', stock: 2 },
      { valeur: 'L', stock: null },
    ],
  },
];

/**
 * Le stock des choix, la date de figeage et ce que le bureau compte. Les
 * garanties de concurrence (deux personnes sur la dernière taille) se
 * constatent contre un vrai Postgres, dans le test e2e.
 */
describe('OptionsEvenementService', () => {
  let service: OptionsEvenementService;
  let evenement: Partial<Evenement>;
  let inscription: Partial<Inscription> | null;
  let inscrits: Partial<Inscription>[];
  let utilisations: {
    cle: string;
    valeur: string;
    confirmees: string;
    en_attente: string;
  }[];
  let sansReponse: { confirmees: string; en_attente: string };
  let update: jest.Mock;
  let notifier: jest.Mock;
  let affectees: number;
  let gestionnaire: {
    query: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(() => {
    evenement = {
      id: 'e1',
      titre: 'Marche sportive',
      dateDebut: DANS(30),
      options: OPTIONS,
      optionsFigeesAvantJours: 3,
    };
    inscription = {
      id: 'i1',
      statut: StatutInscription.CONFIRMEE,
      remisLe: null,
      evenement: evenement as Evenement,
      reponses: { taille: 'M' },
    };
    inscrits = [];
    utilisations = [];
    sansReponse = { confirmees: '0', en_attente: '0' };
    update = jest.fn().mockResolvedValue(undefined);
    notifier = jest.fn().mockResolvedValue(null);

    const requete = jest.fn((sql: string) => {
      if (sql.includes('jsonb_each_text')) return Promise.resolve(utilisations);
      if (sql.includes('jsonb_exists')) return Promise.resolve([sansReponse]);
      return Promise.resolve([]);
    });
    affectees = 1;
    const constructeur: Record<string, jest.Mock> = {};
    for (const nom of ['update', 'set', 'where']) {
      constructeur[nom] = jest.fn(() => constructeur);
    }
    constructeur.execute = jest.fn(() =>
      Promise.resolve({ affected: affectees }),
    );
    gestionnaire = {
      createQueryBuilder: jest.fn(() => constructeur),
      query: requete,
      update,
      save: jest.fn((i: unknown) => Promise.resolve(i)),
    };

    service = new OptionsEvenementService(
      {
        findOne: jest.fn(() => Promise.resolve(inscription)),
        findOneOrFail: jest.fn(() => Promise.resolve(inscription)),
        find: jest.fn(() => Promise.resolve(inscrits)),
        save: jest.fn((i: unknown) => Promise.resolve(i)),
        manager: {
          query: requete,
          transaction: (travail: (g: unknown) => Promise<unknown>) =>
            travail(gestionnaire),
        },
      } as unknown as Repository<Inscription>,
      { manager: { query: requete } } as unknown as Repository<Evenement>,
      {
        trouver: jest.fn(() => Promise.resolve(evenement)),
      } as unknown as EvenementService,
      { notifier } as unknown as NotificationService,
    );
  });

  describe('consulter', () => {
    it('donne le stock restant de chaque valeur', async () => {
      utilisations = [
        { cle: 'taille', valeur: 'M', confirmees: '1', en_attente: '1' },
      ];

      const { options } = await service.consulter('e1');

      expect(options[0].choix).toEqual([
        { valeur: 'M', restant: 0, epuise: true },
        { valeur: 'L', restant: null, epuise: false },
      ]);
    });

    it('dit quand les choix se figent, et s’ils sont encore modifiables', async () => {
      const { figeLe, modifiable } = await service.consulter('e1');

      expect(figeLe?.getTime()).toBe(
        (evenement.dateDebut as Date).getTime() - 3 * 86_400_000,
      );
      expect(modifiable).toBe(true);
    });

    it('n’est plus modifiable une fois la date passée', async () => {
      evenement.dateDebut = DANS(2);

      expect((await service.consulter('e1')).modifiable).toBe(false);
    });

    it('ne dit rien d’un événement sans option', async () => {
      evenement.options = [];

      expect(await service.consulter('e1')).toEqual({
        options: [],
        figeLe: null,
        modifiable: true,
      });
    });
  });

  describe('enregistrerAvecStock', () => {
    const inscrire = (reponses: Record<string, string>) =>
      service.enregistrerAvecStock(evenement as Evenement, reponses, {
        id: 'i2',
      } as Inscription);

    it('enregistre sans verrou quand aucun stock n’est en jeu', async () => {
      await inscrire({ taille: 'L' });

      expect(gestionnaire.query).not.toHaveBeenCalled();
    });

    it('prend le verrou de l’événement quand un stock est en jeu', async () => {
      await inscrire({ taille: 'M' });

      expect(gestionnaire.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['options:e1'],
      );
      expect(gestionnaire.save).toHaveBeenCalled();
    });

    it('refuse une taille épuisée et n’écrit rien', async () => {
      utilisations = [
        { cle: 'taille', valeur: 'M', confirmees: '2', en_attente: '0' },
      ];

      await expect(inscrire({ taille: 'M' })).rejects.toThrow('épuisé');
      expect(gestionnaire.save).not.toHaveBeenCalled();
    });
  });

  describe('modifierReponses', () => {
    const modifier = (valeur: unknown) =>
      service.modifierReponses('i1', 'u1', { taille: valeur });

    it('change la taille et la sauvegarde', async () => {
      await modifier('L');

      expect(update).toHaveBeenCalledWith(Inscription, 'i1', {
        reponses: { taille: 'L' },
      });
    });

    it('refuse une inscription qui n’est pas celle de la personne', async () => {
      inscription = null;

      await expect(modifier('L')).rejects.toThrow(NotFoundException);
    });

    it('refuse sur une inscription annulée ou un billet utilisé', async () => {
      inscription = { ...inscription, statut: StatutInscription.ANNULEE };
      await expect(modifier('L')).rejects.toThrow('annulée');

      inscription = { ...inscription, statut: StatutInscription.UTILISEE };
      await expect(modifier('L')).rejects.toThrow('déjà été utilisé');
    });

    it('refuse une fois le lot remis', async () => {
      inscription = { ...inscription, remisLe: new Date() };

      await expect(modifier('L')).rejects.toThrow('déjà été remis');
    });

    it('refuse une fois les choix figés', async () => {
      evenement.dateDebut = DANS(2);

      await expect(modifier('L')).rejects.toThrow(ConflictException);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuse une valeur hors liste', async () => {
      await expect(modifier('4XL')).rejects.toThrow('pas un choix proposé');
    });

    it('refuse une taille épuisée, sans compter la sienne', async () => {
      utilisations = [
        { cle: 'taille', valeur: 'M', confirmees: '2', en_attente: '0' },
      ];

      await expect(modifier('M')).rejects.toThrow('épuisé');
      expect(gestionnaire.query).toHaveBeenCalledWith(
        expect.stringContaining('jsonb_each_text'),
        ['e1', 'i1'],
      );
    });
  });

  describe('récapitulatif et export', () => {
    it('compte payés, en attente et reste par valeur', async () => {
      utilisations = [
        { cle: 'taille', valeur: 'M', confirmees: '1', en_attente: '1' },
      ];
      sansReponse = { confirmees: '3', en_attente: '2' };

      const [option] = await service.recapitulatif('e1');

      expect(option.choix[0]).toEqual({
        valeur: 'M',
        stock: 2,
        confirmees: 1,
        enAttente: 1,
        restant: 0,
      });
      expect(option.choix[1].restant).toBeNull();
      expect(option.sansReponse).toEqual({ confirmees: 3, enAttente: 2 });
    });

    it('exporte nom par nom, sans les inscriptions annulées', async () => {
      const personne = (nom: string) => ({
        firstName: nom,
        lastName: 'Test',
        email: `${nom}@x.cm`,
      });
      inscrits = [
        {
          user: personne('Awa') as never,
          statut: StatutInscription.CONFIRMEE,
          reponses: { taille: 'L' },
          remisLe: new Date('2026-11-30T08:00:00Z'),
        },
        {
          user: personne('Paul') as never,
          statut: StatutInscription.ANNULEE,
          reponses: { taille: 'M' },
          remisLe: null,
        },
      ];

      const csv = await service.exporterCsv('e1');

      expect(csv).toContain('Taille de T-shirt');
      expect(csv).toContain('Awa@x.cm');
      expect(csv).toContain('2026-11-30T08:00:00.000Z');
      expect(csv).not.toContain('Paul@x.cm');
    });
  });

  describe('relancer', () => {
    it('prévient ceux à qui il manque un choix obligatoire', async () => {
      inscrits = [
        {
          id: 'a',
          statut: StatutInscription.CONFIRMEE,
          reponses: {},
          user: { id: 'u1' } as never,
        },
        {
          id: 'b',
          statut: StatutInscription.CONFIRMEE,
          reponses: { taille: 'L' },
          user: { id: 'u2' } as never,
        },
        {
          id: 'c',
          statut: StatutInscription.ANNULEE,
          reponses: {},
          user: { id: 'u3' } as never,
        },
      ];

      await expect(service.relancer('e1')).resolves.toBe(1);

      expect(notifier).toHaveBeenCalledTimes(1);
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({
          lien: '/billets/a',
          message: expect.stringContaining('taille de t-shirt') as unknown,
        }),
      );
    });

    it('ne fait rien pour un événement sans option', async () => {
      evenement.options = [];

      await expect(service.relancer('e1')).resolves.toBe(0);
      expect(notifier).not.toHaveBeenCalled();
    });
  });

  describe('rouvrirApresPaiement', () => {
    const rouvrir = () =>
      service.rouvrirApresPaiement(
        evenement as Evenement,
        {
          id: 'i1',
          reponses: { taille: 'M' },
        } as unknown as Inscription,
      );

    it('rouvre quand la taille est encore disponible', async () => {
      await expect(rouvrir()).resolves.toBe(true);
    });

    it('ne rouvre pas quand la taille a été prise entre-temps', async () => {
      utilisations = [
        { cle: 'taille', valeur: 'M', confirmees: '2', en_attente: '0' },
      ];

      await expect(rouvrir()).resolves.toBe(false);
      expect(gestionnaire.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('ne rouvre pas une inscription qui ne l’est plus', async () => {
      affectees = 0;

      await expect(rouvrir()).resolves.toBe(false);
    });
  });

  it('consulte avec le rôle du demandeur', async () => {
    await expect(
      service.consulter('e1', { role: Role.ADMIN }),
    ).resolves.toBeDefined();
  });
});
