import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { NotificationService } from '../notification/notification.service';
import { Retrait } from '../paiement/entities/retrait.entity';
import {
  OrigineTransaction,
  Transaction,
} from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { SoldeService } from '../solde/solde.service';
import { User } from '../user/entities/user.entity';
import {
  MouvementFonds,
  StatutMouvementFonds,
  TypeMouvementFonds,
} from './entities/mouvement-fonds.entity';
import { FondsService } from './fonds.service';

/**
 * Le suivi des fonds répond à « où est l'argent ? » : ce qui compte, c'est
 * qu'une sortie ne dépasse jamais la poche, qu'un dépôt ne sorte de la poche
 * que si Fapshi le confirme, et qu'on ne mélange jamais solde Fapshi et poches.
 */
describe('FondsService', () => {
  let service: FondsService;
  let enBase: MouvementFonds[];
  let preuves: { membreId: string; montant: number }[];
  let retraitsAttribues: { membreId: string; montant: number }[];
  let nonAttribue: { somme: string; nombre: string };
  let utilisateurs: Record<string, User>;
  let retraits: { findOneBy: jest.Mock; save: jest.Mock };
  let passerelle: { initier: jest.Mock };
  let transactions: Record<string, jest.Mock>;
  let notifier: jest.Mock;
  let remiseSurPlateforme: jest.Mock;
  let retirerFichiers: jest.Mock;
  let etatSolde: jest.Mock;
  let update: jest.Mock;

  const awa = { id: 'x', firstName: 'Awa', lastName: 'Ngassa' } as User;
  const paul = { id: 'y', firstName: 'Paul', lastName: 'Biya' } as User;

  beforeEach(() => {
    enBase = [];
    preuves = [{ membreId: 'x', montant: 50_000 }];
    retraitsAttribues = [];
    nonAttribue = { somme: '0', nombre: '0' };
    utilisateurs = { x: awa, y: paul };
    update = jest.fn().mockResolvedValue({ affected: 1 });
    notifier = jest.fn().mockResolvedValue(null);
    remiseSurPlateforme = jest.fn().mockResolvedValue(undefined);
    retirerFichiers = jest.fn().mockResolvedValue(undefined);
    etatSolde = jest
      .fn()
      .mockResolvedValue({ soldeFapshi: 100_000, obsolete: false });
    passerelle = {
      initier: jest.fn().mockResolvedValue({
        statut: StatutPaiement.EN_ATTENTE,
        referenceExterne: 'FAP-1',
        urlRedirection: 'https://pay.fapshi.test/1',
      }),
    };
    transactions = {
      ouvrir: jest.fn().mockResolvedValue({}),
      enregistrerReferenceExterne: jest.fn().mockResolvedValue(undefined),
      appliquer: jest.fn().mockResolvedValue(true),
      abandonner: jest.fn().mockResolvedValue(true),
      trouver: jest.fn().mockResolvedValue(null),
    };
    retraits = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'r1', detenteur: null }),
      save: jest.fn().mockImplementation((r: unknown) => r),
    };

    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('justificatifs_paiement')) return preuves;
        if (sql.includes('detenteur_id IS NULL')) return [nonAttribue];
        if (sql.includes('frais_prestataire')) return [{ somme: '0' }];
        return retraitsAttribues;
      }),
    };
    const depot = {
      manager,
      find: jest.fn(() => Promise.resolve(enBase)),
      findAndCount: jest.fn(() => Promise.resolve([enBase, enBase.length])),
      findOne: jest.fn(({ where }: { where: Partial<MouvementFonds> }) =>
        Promise.resolve(
          enBase.find(
            (m) =>
              (where.id && m.id === where.id) ||
              (where.reference && m.reference === where.reference),
          ) ?? null,
        ),
      ),
      findOneOrFail: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(enBase.find((m) => m.id === where.id)),
      ),
      create: jest.fn((m: Partial<MouvementFonds>) => ({
        statut: StatutMouvementFonds.VALIDE,
        fraisPrestataire: 0,
        urlPaiement: null,
        reference: null,
        contrepartie: null,
        ...m,
      })),
      save: jest.fn((m: MouvementFonds) => {
        const existant = enBase.find((e) => e.id === m.id);
        if (existant) return Promise.resolve(Object.assign(existant, m));
        const nouveau = { ...m, id: `m${enBase.length + 1}` };
        enBase.push(nouveau);
        return Promise.resolve(nouveau);
      }),
      update: jest.fn((critere: string | { id: unknown }, valeurs: object) => {
        update(critere, valeurs);
        const cible = enBase.find((m) => m.id === critere);
        if (cible) Object.assign(cible, valeurs);
        return Promise.resolve({ affected: 1 });
      }),
    };
    const repoUsers = {
      findOneBy: jest.fn(({ id }: { id: string }) =>
        Promise.resolve(utilisateurs[id] ?? null),
      ),
      find: jest.fn(() => Promise.resolve([awa, paul])),
    };

    service = new FondsService(
      depot as unknown as Repository<MouvementFonds>,
      retraits as unknown as Repository<Retrait>,
      repoUsers as unknown as Repository<User>,
      { etat: etatSolde } as unknown as SoldeService,
      transactions as unknown as TransactionService,
      passerelle as unknown as PasserellePaiement,
      { notifier } as unknown as NotificationService,
      { remiseSurPlateforme } as unknown as AlerteTresorerieService,
      { retirer: retirerFichiers } as unknown as NettoyageFichiers,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  describe('suivi', () => {
    it('sépare le solde Fapshi des poches, et additionne les deux', async () => {
      const suivi = await service.suivi();

      expect(suivi.soldeFapshi).toBe(100_000);
      expect(suivi.totalPoches).toBe(50_000);
      expect(suivi.totalFonds).toBe(150_000);
      expect(suivi.poches[0]).toMatchObject({
        membre: { id: 'x', nom: 'Awa Ngassa' },
        detient: 50_000,
      });
    });

    it('signale l’argent retiré dont on ignore le détenteur', async () => {
      nonAttribue = { somme: '9000', nombre: '2' };

      const suivi = await service.suivi();

      expect(suivi.nonAttribue).toBe(9_000);
      expect(suivi.retraitsNonAttribues).toBe(2);
      expect(suivi.alertes.join(' ')).toContain('9');
    });

    it('signale une poche négative', async () => {
      preuves = [];
      enBase = [
        {
          id: 'm1',
          type: TypeMouvementFonds.DEPENSE,
          statut: StatutMouvementFonds.VALIDE,
          montant: 3_000,
          membre: awa,
          contrepartie: null,
        } as MouvementFonds,
      ];

      const suivi = await service.suivi();

      expect(suivi.alertes.join(' ')).toContain('Awa Ngassa');
    });

    it('prévient quand la lecture de Fapshi est périmée', async () => {
      etatSolde.mockResolvedValue({ soldeFapshi: 1, obsolete: true });

      const suivi = await service.suivi();

      expect(suivi.alertes.join(' ')).toContain('Fapshi n’a pas répondu');
    });
  });

  describe('déclarer', () => {
    it('enregistre une réception en main propre, sans contrôle de poche', async () => {
      const { mouvement } = await service.declarer(awa, {
        type: TypeMouvementFonds.RECEPTION,
        montant: 7_000,
        libelleTiers: 'Délégué de classe',
        piece: 'justificatifs/recu.png',
      });

      expect(mouvement).toMatchObject({
        origine: 'Délégué de classe',
        piece: 'justificatifs/recu.png',
        statut: StatutMouvementFonds.VALIDE,
      });
    });

    it('refuse une sortie qui dépasse ce que le membre détient', async () => {
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.DEPENSE,
          montant: 50_001,
          libelleTiers: 'Traiteur',
        }),
      ).rejects.toThrow(ConflictException);
      expect(enBase).toHaveLength(0);
    });

    it('ne laisse pas deux sorties simultanées dépasser la poche', async () => {
      const sortie = () =>
        service.declarer(awa, {
          type: TypeMouvementFonds.DEPENSE,
          montant: 30_000,
          libelleTiers: 'Traiteur',
        });

      const resultats = await Promise.allSettled([sortie(), sortie()]);

      expect(
        resultats.map((r) => r.status).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['fulfilled', 'rejected']);
    });

    it('exige un bénéficiaire pour un remboursement', async () => {
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.REMBOURSEMENT,
          montant: 1_000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passe l’argent à un autre membre et le prévient', async () => {
      await service.declarer(awa, {
        type: TypeMouvementFonds.TRANSFERT,
        montant: 10_000,
        contrepartieId: 'y',
      });

      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({
          destinataire: paul,
          titre: 'Remise reçue',
          message: expect.stringContaining('Awa Ngassa') as unknown,
        }),
      );
    });

    it('refuse un transfert vers soi-même ou vers un inconnu', async () => {
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.TRANSFERT,
          montant: 1_000,
          contrepartieId: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.TRANSFERT,
          montant: 1_000,
          contrepartieId: 'zz',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.TRANSFERT,
          montant: 1_000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('garde trace de la trésorerie qui saisit pour un autre membre', async () => {
      const { mouvement } = await service.declarer(paul, {
        type: TypeMouvementFonds.RECEPTION,
        montant: 2_000,
        membreId: 'x',
      });

      expect(mouvement).toMatchObject({
        membre: awa,
        declarePar: { id: 'y' },
      });
    });

    it('refuse un membre inconnu', async () => {
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.RECEPTION,
          montant: 1_000,
          membreId: 'zz',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('dépôt sur la plateforme', () => {
    const deposer = () =>
      service.declarer(awa, {
        type: TypeMouvementFonds.DEPOT_PLATEFORME,
        montant: 20_000,
      });

    it('ouvre un paiement Fapshi de type remise et renvoie sa page', async () => {
      const resultat = await deposer();

      expect(transactions.ouvrir).toHaveBeenCalledWith(
        expect.objectContaining({
          origine: OrigineTransaction.REMISE,
          montant: 20_000,
          user: awa,
        }),
      );
      expect(passerelle.initier).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: expect.stringMatching(/^REM-/) as unknown,
          montant: 20_000,
        }),
      );
      expect(resultat.urlPaiement).toBe('https://pay.fapshi.test/1');
      expect(resultat.mouvement).toMatchObject({
        statut: StatutMouvementFonds.EN_ATTENTE,
      });
    });

    it('réserve l’argent du dépôt tant que Fapshi n’a pas confirmé', async () => {
      await deposer();

      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.DEPENSE,
          montant: 40_000,
          libelleTiers: 'Traiteur',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse un dépôt plus gros que la poche', async () => {
      await expect(
        service.declarer(awa, {
          type: TypeMouvementFonds.DEPOT_PLATEFORME,
          montant: 90_000,
        }),
      ).rejects.toThrow(ConflictException);
      expect(passerelle.initier).not.toHaveBeenCalled();
    });

    it('referme le dépôt quand Fapshi refuse la demande', async () => {
      passerelle.initier.mockRejectedValue(new Error('Fapshi indisponible'));

      await expect(deposer()).rejects.toThrow('Fapshi indisponible');

      expect(transactions.abandonner).toHaveBeenCalled();
      expect(enBase[0].statut).toBe(StatutMouvementFonds.ECHOUE);
    });

    it('applique tout de suite un dépôt abouti dès l’appel', async () => {
      passerelle.initier.mockResolvedValue({
        statut: StatutPaiement.COMPLETE,
        referenceExterne: 'FAP-2',
        urlRedirection: null,
      });
      transactions.trouver.mockImplementation((reference: string) =>
        Promise.resolve({ reference } as Transaction),
      );

      const resultat = await deposer();

      expect(resultat.mouvement).toMatchObject({
        statut: StatutMouvementFonds.VALIDE,
      });
      expect(remiseSurPlateforme).toHaveBeenCalledWith(awa, 20_000);
    });

    it('refuse un dépôt que l’opérateur a rejeté', async () => {
      passerelle.initier.mockResolvedValue({
        statut: StatutPaiement.ECHOUE,
        referenceExterne: null,
        urlRedirection: null,
      });

      await expect(deposer()).rejects.toThrow(BadRequestException);
      expect(enBase[0].statut).toBe(StatutMouvementFonds.ECHOUE);
    });
  });

  describe('issue d’un dépôt', () => {
    const depot = (): MouvementFonds =>
      ({
        id: 'm1',
        type: TypeMouvementFonds.DEPOT_PLATEFORME,
        statut: StatutMouvementFonds.EN_ATTENTE,
        montant: 20_000,
        reference: 'REM-1',
        membre: awa,
      }) as MouvementFonds;

    it('valide le dépôt, prévient le membre et la trésorerie', async () => {
      enBase = [depot()];

      await service.traiterIssue(
        { reference: 'REM-1' } as Transaction,
        StatutPaiement.COMPLETE,
      );

      expect(enBase[0].statut).toBe(StatutMouvementFonds.VALIDE);
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({ titre: 'Dépôt reçu sur la plateforme' }),
      );
      expect(remiseSurPlateforme).toHaveBeenCalledWith(awa, 20_000);
    });

    it('marque le dépôt échoué et rend l’argent disponible', async () => {
      enBase = [depot()];

      await service.traiterIssue(
        { reference: 'REM-1' } as Transaction,
        StatutPaiement.ECHOUE,
      );

      expect(enBase[0].statut).toBe(StatutMouvementFonds.ECHOUE);
      expect(remiseSurPlateforme).not.toHaveBeenCalled();
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({ titre: 'Dépôt non abouti' }),
      );
    });

    it('ignore une référence inconnue', async () => {
      await service.traiterIssue(
        { reference: 'REM-X' } as Transaction,
        StatutPaiement.COMPLETE,
      );

      expect(notifier).not.toHaveBeenCalled();
    });

    it('abandonne un dépôt en attente, et lui seul', async () => {
      enBase = [depot()];

      const abandonne = await service.abandonnerDepot('m1');

      expect(abandonne.statut).toBe(StatutMouvementFonds.ECHOUE);
      expect(transactions.abandonner).toHaveBeenCalledWith('REM-1');
      await expect(service.abandonnerDepot('m1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.abandonnerDepot('inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('attribuer un retrait', () => {
    it('rattache le retrait au membre qui a reçu l’argent', async () => {
      const retrait = await service.attribuerRetrait('r1', 'y');

      expect(retrait.detenteur).toBe(paul);
    });

    it('le détache quand on passe null', async () => {
      const retrait = await service.attribuerRetrait('r1', null);

      expect(retrait.detenteur).toBeNull();
    });

    it('refuse un retrait ou un membre inconnu', async () => {
      retraits.findOneBy.mockResolvedValue(null);
      await expect(service.attribuerRetrait('rx', 'y')).rejects.toThrow(
        NotFoundException,
      );
      retraits.findOneBy.mockResolvedValue({ id: 'r1' });
      await expect(service.attribuerRetrait('r1', 'zz')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('purge des pièces', () => {
    it('efface la pièce des mouvements anciens et garde la ligne', async () => {
      enBase = [
        { id: 'm1', piece: 'justificatifs/a.png' },
        { id: 'm2', piece: null },
      ] as MouvementFonds[];

      const purgees = await service.purgerPieces();

      expect(purgees).toBe(1);
      expect(retirerFichiers).toHaveBeenCalledWith('justificatifs/a.png');
    });

    it('ne fait rien sans pièce à effacer', async () => {
      enBase = [{ id: 'm2', piece: null }] as MouvementFonds[];

      await expect(service.purgerPieces()).resolves.toBe(0);
      expect(retirerFichiers).not.toHaveBeenCalled();
    });
  });
});
