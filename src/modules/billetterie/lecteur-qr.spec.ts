import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { ActiviteService } from '../activite/activite.service';
import {
  ControleAcces,
  Evenement,
} from '../evenement/entities/evenement.entity';
import { EvenementService } from '../evenement/evenement.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notification/notification.service';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { BilletterieService } from './billetterie.service';
import { AffectationScanner } from './entities/affectation-scanner.entity';
import { Inscription, StatutInscription } from './entities/inscription.entity';
import { PurgeTracesScanService } from './purge-traces-scan.service';

/**
 * Le contrôle à l'entrée, confié à des portiers.
 *
 * Deux garde-fous se rejoignent ici : **l'affectation**, qui laisse valider
 * des billets sans confier les clés de la plateforme, et **la fenêtre**, qui
 * empêche un billet du gala de juin de servir l'an suivant. Les tests
 * vérifient surtout ce que chacun refuse.
 */
const PORTIERE = { id: 'user-portiere', role: Role.STUDENT };
const MEMBRE_BUREAU = { id: 'user-bureau', role: Role.ADMIN };
const EXPLOITATION = { id: 'user-exploitation', role: Role.SUPER_ADMIN };

describe('Lecteur QR — portiers', () => {
  let service: BilletterieService;

  let inscriptions: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let affectations: {
    existsBy: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let evenements: { trouver: jest.Mock };
  let utilisateurs: { trouverOuEchouer: jest.Mock };
  let journaliser: jest.Mock;
  /** Dernier `set(...)` passé au constructeur de requête de mise à jour. */
  let misAJour: Record<string, unknown>;
  /** Derniers paramètres de `where(...)`, pour lire la limite de la purge. */
  let conditions: Record<string, unknown>;
  let affectees: number;

  const evenement = (surcharge: Partial<Evenement> = {}): Evenement =>
    ({
      id: 'evt-gala',
      titre: 'Gala des finissants',
      controleAcces: ControleAcces.QR_FIXE,
      // Un moment où la fenêtre est ouverte, quel que soit le jour du test :
      // sinon la suite ne passerait qu'une nuit sur deux.
      dateDebut: new Date(Date.now() - 60 * 60 * 1000),
      dateFin: null,
      ...surcharge,
    }) as Evenement;

  const billet = (surcharge: Partial<Inscription> = {}): Inscription =>
    ({
      id: 'ins-1',
      codeBillet: 'COCFET-ABCDEF',
      statut: StatutInscription.CONFIRMEE,
      scannedAt: null,
      user: { id: 'user-invite', firstName: 'Awa', lastName: 'Ndiaye' } as User,
      evenement: evenement(),
      ...surcharge,
    }) as Inscription;

  beforeEach(() => {
    misAJour = {};
    conditions = {};
    affectees = 1;

    // Typé explicitement : les méthodes se renvoient elles-mêmes, et sans
    // annotation TypeScript ne sait pas fermer la boucle.
    const constructeur: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      execute: jest.Mock;
    } = {
      update: jest.fn(() => constructeur),
      set: jest.fn((valeurs: Record<string, unknown>) => {
        misAJour = valeurs;
        return constructeur;
      }),
      where: jest.fn((_sql: string, parametres: Record<string, unknown>) => {
        conditions = parametres;
        return constructeur;
      }),
      execute: jest.fn(() => Promise.resolve({ affected: affectees })),
    };

    inscriptions = {
      findOne: jest.fn().mockResolvedValue(billet()),
      findOneOrFail: jest.fn((options: { where: { id: string } }) =>
        Promise.resolve(billet({ id: options.where.id })),
      ),
      createQueryBuilder: jest.fn(() => constructeur),
    };

    affectations = {
      existsBy: jest.fn().mockResolvedValue(false),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn().mockResolvedValue({ id: 'aff-1' }),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((donnees: object) => donnees),
      save: jest.fn((donnees: object) =>
        Promise.resolve({ id: 'aff-1', ...donnees }),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    evenements = { trouver: jest.fn().mockResolvedValue(evenement()) };
    utilisateurs = {
      trouverOuEchouer: jest.fn().mockResolvedValue({ id: PORTIERE.id }),
    };
    journaliser = jest.fn().mockResolvedValue(undefined);

    service = new BilletterieService(
      inscriptions as unknown as Repository<Inscription>,
      affectations as unknown as Repository<AffectationScanner>,
      evenements as unknown as EvenementService,
      {} as NotificationService,
      {} as MailService,
      {} as PasserellePaiement,
      {} as TransactionService,
      { journaliser } as unknown as ActiviteService,
      utilisateurs as unknown as UserService,
      {
        get: jest.fn(),
        getOrThrow: jest.fn().mockReturnValue('secret-de-test'),
      } as unknown as ConfigService,
    );
  });

  describe('qui peut valider', () => {
    it('laisse passer le portier affecté à cet événement', async () => {
      affectations.existsBy.mockResolvedValue(true);

      await expect(
        service.scanner('COCFET-ABCDEF', PORTIERE),
      ).resolves.toBeDefined();

      expect(affectations.existsBy).toHaveBeenCalledWith({
        evenement: { id: 'evt-gala' },
        user: { id: PORTIERE.id },
      });
    });

    it('refuse le portier qu’on n’a pas placé à cette porte', async () => {
      // Le point de la fonctionnalité : sans ce rattachement, le portier du
      // gala validerait les billets de la conférence du lendemain.
      await expect(service.scanner('COCFET-ABCDEF', PORTIERE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('laisse passer le bureau sans affectation', async () => {
      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).resolves.toBeDefined();

      expect(affectations.existsBy).not.toHaveBeenCalled();
    });

    it('laisse passer l’exploitation sans affectation', async () => {
      // `SUPER_ADMIN` est au-dessus du bureau : le laisser dehors le rendrait
      // moins puissant que l'administration ordinaire.
      await expect(
        service.scanner('COCFET-ABCDEF', EXPLOITATION),
      ).resolves.toBeDefined();

      expect(affectations.existsBy).not.toHaveBeenCalled();
    });
  });

  describe('la fenêtre de validation', () => {
    it('refuse avant l’ouverture', async () => {
      inscriptions.findOne.mockResolvedValue(
        billet({
          evenement: evenement({
            dateDebut: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/pas encore commencé/);
    });

    it('refuse une fois la fenêtre refermée', async () => {
      inscriptions.findOne.mockResolvedValue(
        billet({
          evenement: evenement({
            dateDebut: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          }),
        }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(ConflictException);
    });

    it('bloque sur l’heure avant de reprocher l’affectation', async () => {
      // Un portier arrivé la veille doit s'entendre dire que c'est trop tôt,
      // pas qu'il n'a rien à faire là : le second message l'enverrait
      // appeler le bureau pour un problème qui n'existe pas.
      inscriptions.findOne.mockResolvedValue(
        billet({
          evenement: evenement({
            dateDebut: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        }),
      );

      await expect(service.scanner('COCFET-ABCDEF', PORTIERE)).rejects.toThrow(
        /pas encore commencé/,
      );
    });

    it('passe la fenêtre avant l’état du billet', async () => {
      // Même raison : reprocher un billet annulé alors que la salle est
      // fermée depuis un an envoie chercher le mauvais problème.
      inscriptions.findOne.mockResolvedValue(
        billet({
          statut: StatutInscription.ANNULEE,
          evenement: evenement({
            dateDebut: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          }),
        }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/terminé/);
    });
  });

  describe('ce que le portier s’entend refuser', () => {
    it('refuse un code illisible sans dire pourquoi', async () => {
      // Jeton mal formé, périmé ou mal signé : le même refus dans les trois
      // cas. Distinguer aiderait à en fabriquer un.
      await expect(
        service.scanner('v1.nimporte.quoi', PORTIERE),
      ).rejects.toThrow(/faites-le régénérer/);
      expect(inscriptions.findOne).not.toHaveBeenCalled();
    });

    it('refuse un code inconnu', async () => {
      inscriptions.findOne.mockResolvedValue(null);

      await expect(
        service.scanner('COCFET-INCONNU', MEMBRE_BUREAU),
      ).rejects.toThrow(/inconnu/);
    });

    it('refuse de valider un événement qui ne filtre pas l’entrée', async () => {
      inscriptions.findOne.mockResolvedValue(
        billet({
          evenement: evenement({ controleAcces: ControleAcces.AUCUN }),
        }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/pas de billet à valider/);
    });

    it('refuse un code fixe là où le code tournant est exigé', async () => {
      // Sans ce refus, l'option ne servirait à rien : une capture d'écran du
      // code fixe suffirait à entrer.
      inscriptions.findOne.mockResolvedValue(
        billet({
          evenement: evenement({ controleAcces: ControleAcces.QR_TOURNANT }),
        }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/code tournant/);
    });

    it('refuse un billet annulé', async () => {
      inscriptions.findOne.mockResolvedValue(
        billet({ statut: StatutInscription.ANNULEE }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/annulé/);
    });

    it('refuse un billet impayé', async () => {
      inscriptions.findOne.mockResolvedValue(
        billet({ statut: StatutInscription.EN_ATTENTE }),
      );

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/n'est pas payé/);
    });
  });

  describe('la trace du passage', () => {
    it('rattache le billet validé à son portier', async () => {
      affectations.existsBy.mockResolvedValue(true);

      await service.scanner('COCFET-ABCDEF', PORTIERE);

      // « quand » sans « qui » ne permet aucune vérification a posteriori.
      expect(misAJour.scannePar).toEqual({ id: PORTIERE.id });
      expect(misAJour.statut).toBe(StatutInscription.UTILISEE);
      expect(misAJour.scannedAt).toBeInstanceOf(Date);
    });

    it('ne journalise rien quand le billet était déjà passé', async () => {
      affectees = 0;

      await expect(
        service.scanner('COCFET-ABCDEF', MEMBRE_BUREAU),
      ).rejects.toThrow(/déjà été scanné/);
      expect(journaliser).not.toHaveBeenCalled();
    });
  });

  describe('placer et retirer les portiers', () => {
    it('vérifie l’événement et la personne avant d’écrire', async () => {
      // Un identifiant erroné remonterait sinon en violation de clé
      // étrangère, soit une erreur serveur là où le bureau mérite de savoir
      // lequel des deux n'existe pas.
      await service.affecterScanner('evt-gala', PORTIERE.id, MEMBRE_BUREAU.id);

      expect(evenements.trouver).toHaveBeenCalledWith('evt-gala', {
        role: Role.ADMIN,
      });
      expect(utilisateurs.trouverOuEchouer).toHaveBeenCalledWith(PORTIERE.id);
    });

    it('enregistre qui a placé le portier', async () => {
      await service.affecterScanner('evt-gala', PORTIERE.id, MEMBRE_BUREAU.id);

      expect(affectations.save).toHaveBeenCalledWith({
        evenement: { id: 'evt-gala' },
        user: { id: PORTIERE.id },
        affectePar: { id: MEMBRE_BUREAU.id },
      });
    });

    it('relit l’affectation créée pour en rendre les noms', async () => {
      // `save` ne rend que les références passées : le bureau recevrait deux
      // identifiants nus là où il attend des noms.
      const relue = { id: 'aff-1', user: { id: PORTIERE.id } };
      affectations.findOneOrFail.mockResolvedValue(relue);

      await expect(
        service.affecterScanner('evt-gala', PORTIERE.id, MEMBRE_BUREAU.id),
      ).resolves.toBe(relue);
    });

    it('ne crée pas de doublon en réaffectant la même personne', async () => {
      const existante = { id: 'aff-1' };
      affectations.findOne.mockResolvedValue(existante);

      await expect(
        service.affecterScanner('evt-gala', PORTIERE.id, MEMBRE_BUREAU.id),
      ).resolves.toBe(existante);
      expect(affectations.save).not.toHaveBeenCalled();
    });

    it('retire un portier de son poste', async () => {
      await service.retirerScanner('evt-gala', PORTIERE.id);

      expect(affectations.delete).toHaveBeenCalledWith({
        evenement: { id: 'evt-gala' },
        user: { id: PORTIERE.id },
      });
    });

    it('reste silencieux quand le portier est déjà retiré', async () => {
      // Le résultat voulu est atteint : une erreur ferait croire à un échec.
      affectations.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.retirerScanner('evt-gala', PORTIERE.id),
      ).resolves.toBeUndefined();
    });

    it('rend les portiers avec les noms, pas des identifiants', async () => {
      await service.listerScanners('evt-gala');

      expect(affectations.find).toHaveBeenCalledWith({
        where: { evenement: { id: 'evt-gala' } },
        relations: { user: true, affectePar: true },
      });
    });
  });

  describe('purge des traces', () => {
    it('efface le portier au-delà d’une semaine, jamais le passage', async () => {
      const effacees = await service.purgerTracesScan();

      expect(effacees).toBe(1);
      // Seul le nom s'efface : « scannedAt » dit que la personne est entrée,
      // et le comptage des entrées en dépend.
      expect(misAJour).toEqual({ scannePar: null });
    });

    it('ne remonte que les passages plus vieux qu’une semaine', async () => {
      await service.purgerTracesScan();

      const limite = (conditions.limite as Date).getTime();
      const attendue = Date.now() - 7 * 24 * 60 * 60 * 1000;

      // À la seconde près : le test ne doit pas dépendre de sa propre durée.
      expect(Math.abs(limite - attendue)).toBeLessThan(5000);
    });
  });
});

describe('PurgeTracesScanService', () => {
  it('ne laisse pas un échec faire tomber la tâche planifiée', async () => {
    // Sans cela, une purge ratée emporterait la planification et plus rien ne
    // serait jamais purgé ensuite.
    const purgerTracesScan = jest.fn().mockRejectedValue(new Error('base'));
    const tache = new PurgeTracesScanService({
      purgerTracesScan,
    } as unknown as BilletterieService);

    await expect(tache.purger()).resolves.toBeUndefined();
    expect(purgerTracesScan).toHaveBeenCalled();
  });

  it('reste muet quand il n’y avait rien à effacer', async () => {
    // Une ligne de journal chaque nuit pour ne rien dire finirait par noyer
    // celles qui comptent.
    const purgerTracesScan = jest.fn().mockResolvedValue(0);
    const tache = new PurgeTracesScanService({
      purgerTracesScan,
    } as unknown as BilletterieService);
    const journal = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await tache.purger();

    expect(journal).not.toHaveBeenCalled();
    journal.mockRestore();
  });

  it('délègue la purge au service métier', async () => {
    const purgerTracesScan = jest.fn().mockResolvedValue(4);
    const tache = new PurgeTracesScanService({
      purgerTracesScan,
    } as unknown as BilletterieService);

    await tache.purger();

    expect(purgerTracesScan).toHaveBeenCalledTimes(1);
  });
});
