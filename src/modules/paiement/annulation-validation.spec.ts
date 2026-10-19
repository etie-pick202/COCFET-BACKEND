import { ConflictException } from '@nestjs/common';
import { BilletterieService } from '../billetterie/billetterie.service';
import { StatutInscription } from '../billetterie/entities/inscription.entity';
import { CommandeService } from '../commande/commande.service';
import { StatutCommande } from '../commande/entities/commande.entity';
import { CotisationService } from '../cotisation/cotisation.service';
import { ModeReglement } from '../cotisation/entities/reglement-cotisation.entity';
import { StatutParticipation } from '../cotisation/entities/participation-cotisation.entity';
import { DocumentService } from '../document/document.service';
import { TypeDocument } from '../document/entities/document.entity';
import { OrigineTransaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { RepercussionPaiementService } from './repercussion-paiement.service';
import { TransactionService } from './transaction.service';

/** Constructeur de mise à jour, qui rend `affected` lignes touchées. */
const miseAJour = (affected: number) => {
  const faux = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  faux.update.mockReturnValue(faux);
  faux.set.mockReturnValue(faux);
  faux.where.mockReturnValue(faux);
  return faux;
};

/**
 * Défaire une validation faite par erreur : ce qui se reprend, ce qui ne se
 * reprend pas, et que rien ne bouge quand un domaine refuse.
 */
describe('annulation d’une validation de paiement', () => {
  describe('TransactionService.rouvrir', () => {
    it('remet la transaction en attente, au montant annoncé', async () => {
      const requete = miseAJour(1);
      const service = new TransactionService({
        createQueryBuilder: () => requete,
      } as never);

      await expect(service.rouvrir('COT-1', 10_000)).resolves.toBe(true);

      expect(requete.set).toHaveBeenCalledWith({
        statut: StatutPaiement.EN_ATTENTE,
        montant: 10_000,
      });
    });

    it('ne fait rien sur une transaction déjà rouverte', async () => {
      const service = new TransactionService({
        createQueryBuilder: () => miseAJour(0),
      } as never);

      await expect(service.rouvrir('COT-1', 10_000)).resolves.toBe(false);
    });
  });

  describe('DocumentService.retirerFacture', () => {
    const construire = (document: object | null, supprimer = jest.fn()) => {
      const documents = {
        findOne: jest.fn().mockResolvedValue(document),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const service = Object.create(DocumentService.prototype) as {
        retirerFacture: DocumentService['retirerFacture'];
        documents: typeof documents;
        stockage: { supprimer: jest.Mock };
        logger: { warn: jest.Mock };
      };
      service.documents = documents;
      service.stockage = { supprimer };
      service.logger = { warn: jest.fn() };
      return { service, documents };
    };

    it('supprime la facture et son fichier, et rend son numéro', async () => {
      const supprimer = jest.fn().mockResolvedValue(undefined);
      const { service, documents } = construire(
        { id: 'd1', numero: 'FAC-2027-0042', cle: 'documents/d1.pdf' },
        supprimer,
      );

      await expect(
        service.retirerFacture(TypeDocument.FACTURE_COTISATION, 'r1'),
      ).resolves.toBe('FAC-2027-0042');

      expect(documents.delete).toHaveBeenCalledWith('d1');
      expect(supprimer).toHaveBeenCalledWith('documents/d1.pdf');
    });

    it('ne fait rien quand aucune facture n’a été émise', async () => {
      const { service, documents } = construire(null);

      await expect(
        service.retirerFacture(TypeDocument.FACTURE_COMMANDE, 'c1'),
      ).resolves.toBeNull();
      expect(documents.delete).not.toHaveBeenCalled();
    });

    it('supprime la ligne même quand le fichier est déjà absent', async () => {
      const { service, documents } = construire(
        { id: 'd1', numero: 'FAC-1', cle: 'documents/d1.pdf' },
        jest.fn().mockRejectedValue(new Error('absent')),
      );

      await expect(
        service.retirerFacture(TypeDocument.RECU_BILLETTERIE, 'i1'),
      ).resolves.toBe('FAC-1');
      expect(documents.delete).toHaveBeenCalled();
    });

    it('ne touche pas au stockage d’une facture dont le fichier est purgé', async () => {
      const supprimer = jest.fn();
      const { service } = construire(
        { id: 'd1', numero: 'FAC-1', cle: null },
        supprimer,
      );

      await service.retirerFacture(TypeDocument.FACTURE_COTISATION, 'r1');

      expect(supprimer).not.toHaveBeenCalled();
    });
  });

  describe('aiguillage par origine', () => {
    const construire = (origine: OrigineTransaction | null) => {
      const cotisation = jest.fn().mockResolvedValue('reglement-1');
      const commande = jest.fn().mockResolvedValue('commande-1');
      const billet = jest.fn().mockResolvedValue('inscription-1');
      const service = new RepercussionPaiementService(
        { annulerReglementJustificatif: cotisation } as never,
        {
          trouver: jest.fn().mockResolvedValue(origine ? { origine } : null),
        } as never,
        { annulerConfirmationHorsLigne: billet } as never,
        { annulerPaiementHorsLigne: commande } as never,
        {} as never,
      );
      return { service, cotisation, commande, billet };
    };

    it('défait un règlement de cotisation, et rend sa facture', async () => {
      const { service, cotisation } = construire(OrigineTransaction.COTISATION);

      await expect(service.annuler('COT-1', 10_000)).resolves.toEqual({
        type: TypeDocument.FACTURE_COTISATION,
        source: 'reglement-1',
      });
      expect(cotisation).toHaveBeenCalledWith('COT-1', 10_000);
    });

    it('défait une commande', async () => {
      const { service, commande } = construire(OrigineTransaction.BOUTIQUE);

      await expect(service.annuler('c1', 5_000)).resolves.toEqual({
        type: TypeDocument.FACTURE_COMMANDE,
        source: 'commande-1',
      });
      expect(commande).toHaveBeenCalledWith('c1');
    });

    it('défait un billet', async () => {
      const { service, billet } = construire(OrigineTransaction.EVENEMENT);

      await expect(service.annuler('B-1', 5_000)).resolves.toEqual({
        type: TypeDocument.RECU_BILLETTERIE,
        source: 'inscription-1',
      });
      expect(billet).toHaveBeenCalledWith('B-1');
    });

    it('ne défait rien pour une transaction inconnue ou un dépôt de membre', async () => {
      expect(await construire(null).service.annuler('X', 1)).toBeNull();
      expect(
        await construire(OrigineTransaction.REMISE).service.annuler('REM-1', 1),
      ).toBeNull();
    });
  });

  describe('BilletterieService.annulerConfirmationHorsLigne', () => {
    const construire = (
      statut: StatutInscription,
      affected = 1,
      relue: StatutInscription = statut,
    ) => {
      const requete = miseAJour(affected);
      const inscriptions = {
        findOne: jest.fn().mockResolvedValue({ id: 'i1', statut }),
        findOneByOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'i1', statut: relue }),
        createQueryBuilder: () => requete,
      };
      const service = Object.create(BilletterieService.prototype) as {
        annulerConfirmationHorsLigne: BilletterieService['annulerConfirmationHorsLigne'];
        inscriptions: typeof inscriptions;
      };
      service.inscriptions = inscriptions;
      return { service, requete };
    };

    it('remet le billet en attente', async () => {
      const { service, requete } = construire(StatutInscription.CONFIRMEE);

      await expect(service.annulerConfirmationHorsLigne('B-1')).resolves.toBe(
        'i1',
      );
      expect(requete.set).toHaveBeenCalledWith({
        statut: StatutInscription.EN_ATTENTE,
        statutPaiement: StatutPaiement.EN_ATTENTE,
      });
    });

    it('refuse un billet déjà scanné : la personne est entrée', async () => {
      const { service, requete } = construire(StatutInscription.UTILISEE);

      await expect(service.annulerConfirmationHorsLigne('B-1')).rejects.toThrow(
        'déjà été scanné',
      );
      expect(requete.execute).not.toHaveBeenCalled();
    });

    it('refuse une inscription annulée', async () => {
      const { service } = construire(StatutInscription.ANNULEE);

      await expect(service.annulerConfirmationHorsLigne('B-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuse un billet scanné entre la lecture et l’écriture', async () => {
      const { service } = construire(
        StatutInscription.CONFIRMEE,
        0,
        StatutInscription.UTILISEE,
      );

      await expect(service.annulerConfirmationHorsLigne('B-1')).rejects.toThrow(
        'déjà été scanné',
      );
    });

    it('ne fait rien pour une référence qui n’est pas un billet', async () => {
      const service = Object.create(BilletterieService.prototype) as {
        annulerConfirmationHorsLigne: BilletterieService['annulerConfirmationHorsLigne'];
        inscriptions: unknown;
      };
      service.inscriptions = { findOne: jest.fn().mockResolvedValue(null) };

      await expect(
        service.annulerConfirmationHorsLigne('?'),
      ).resolves.toBeNull();
    });
  });

  describe('CommandeService.annulerPaiementHorsLigne', () => {
    const construire = (
      statut: StatutCommande,
      affected = 1,
      relue: StatutCommande = statut,
    ) => {
      const requete = miseAJour(affected);
      const commandes = {
        findOne: jest.fn().mockResolvedValue({ id: 'c1', statut }),
        findOneByOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'c1', statut: relue }),
        createQueryBuilder: () => requete,
      };
      const service = Object.create(CommandeService.prototype) as {
        annulerPaiementHorsLigne: CommandeService['annulerPaiementHorsLigne'];
        commandes: typeof commandes;
      };
      service.commandes = commandes;
      return { service, requete };
    };

    it('remet la commande en attente de paiement', async () => {
      const { service, requete } = construire(StatutCommande.PAYEE);

      await expect(service.annulerPaiementHorsLigne('c1')).resolves.toBe('c1');
      expect(requete.set).toHaveBeenCalledWith({
        statut: StatutCommande.EN_ATTENTE,
        statutPaiement: StatutPaiement.EN_ATTENTE,
      });
    });

    it.each([StatutCommande.PRETE, StatutCommande.RETIREE])(
      'refuse une commande %s : la marchandise est préparée ou remise',
      async (statut) => {
        const { service, requete } = construire(statut);

        await expect(service.annulerPaiementHorsLigne('c1')).rejects.toThrow(
          'prête ou retirée',
        );
        expect(requete.execute).not.toHaveBeenCalled();
      },
    );

    it('refuse une commande annulée', async () => {
      const { service } = construire(StatutCommande.ANNULEE);

      await expect(service.annulerPaiementHorsLigne('c1')).rejects.toThrow(
        'annulée',
      );
    });

    it('refuse une commande passée prête entre la lecture et l’écriture', async () => {
      const { service } = construire(
        StatutCommande.PAYEE,
        0,
        StatutCommande.PRETE,
      );

      await expect(service.annulerPaiementHorsLigne('c1')).rejects.toThrow(
        'prête ou retirée',
      );
    });

    it('ne fait rien pour une référence qui n’est pas une commande', async () => {
      const service = Object.create(CommandeService.prototype) as {
        annulerPaiementHorsLigne: CommandeService['annulerPaiementHorsLigne'];
        commandes: unknown;
      };
      service.commandes = { findOne: jest.fn().mockResolvedValue(null) };

      await expect(service.annulerPaiementHorsLigne('?')).resolves.toBeNull();
    });
  });

  describe('CotisationService.annulerReglementJustificatif', () => {
    interface Etat {
      reglementStatut: StatutPaiement;
      mode: ModeReglement;
      montantRegle: number;
      statut: StatutParticipation;
      /** Ce que `findOneOrFail` rend du solde après retrait. */
      soldeApres: number;
    }

    const construire = (surcharge: Partial<Etat> = {}, connu = true) => {
      const etat: Etat = {
        reglementStatut: StatutPaiement.COMPLETE,
        mode: ModeReglement.JUSTIFICATIF,
        montantRegle: 10_000,
        statut: StatutParticipation.EN_COURS,
        soldeApres: 0,
        ...surcharge,
      };
      const reglement = {
        id: 'r1',
        montant: 10_000,
        mode: etat.mode,
        participation: { id: 'p1' },
      };
      const gestionnaire = {
        findOneOrFail: jest.fn((entite: { name: string }) =>
          Promise.resolve(
            entite.name === 'ReglementCotisation'
              ? reglement
              : {
                  id: 'p1',
                  montantDu: 30_000,
                  montantRegle: etat.soldeApres,
                  statut: etat.statut,
                },
          ),
        ),
        createQueryBuilder: () =>
          miseAJour(etat.reglementStatut === StatutPaiement.COMPLETE ? 1 : 0),
        decrement: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const reglements = {
        findOne: jest
          .fn()
          .mockResolvedValue(connu ? { ...reglement, mode: etat.mode } : null),
        manager: {
          transaction: (travail: (g: unknown) => Promise<unknown>) =>
            travail(gestionnaire),
        },
      };
      const service = Object.create(CotisationService.prototype) as {
        annulerReglementJustificatif: CotisationService['annulerReglementJustificatif'];
        reglements: typeof reglements;
        verrous: Map<string, Promise<void>>;
      };
      service.reglements = reglements;
      service.verrous = new Map();
      return { service, gestionnaire };
    };

    it('retire le crédit du solde et rouvre le règlement', async () => {
      const { service, gestionnaire } = construire();

      await expect(
        service.annulerReglementJustificatif('COT-1', 10_000),
      ).resolves.toBe('r1');

      expect(gestionnaire.decrement).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'p1' },
        'montantRegle',
        10_000,
      );
    });

    it('repasse en cours une participation qui n’est plus soldée', async () => {
      const { service, gestionnaire } = construire({
        statut: StatutParticipation.SOLDEE,
        soldeApres: 20_000,
      });

      await service.annulerReglementJustificatif('COT-1', 10_000);

      expect(gestionnaire.update).toHaveBeenCalledWith(
        expect.anything(),
        'p1',
        { statut: StatutParticipation.EN_COURS },
      );
    });

    it('garde soldée une participation qui l’est encore après retrait', async () => {
      const { service, gestionnaire } = construire({
        statut: StatutParticipation.SOLDEE,
        soldeApres: 30_000,
      });

      await service.annulerReglementJustificatif('COT-1', 10_000);

      expect(gestionnaire.update).not.toHaveBeenCalled();
    });

    it('ne retire pas le crédit deux fois', async () => {
      const { service, gestionnaire } = construire({
        reglementStatut: StatutPaiement.EN_ATTENTE,
      });

      await expect(
        service.annulerReglementJustificatif('COT-1', 10_000),
      ).resolves.toBe('r1');
      expect(gestionnaire.decrement).not.toHaveBeenCalled();
    });

    it('interrompt tout plutôt que d’écrire un solde négatif', async () => {
      const { service } = construire({ soldeApres: -5_000 });

      await expect(
        service.annulerReglementJustificatif('COT-1', 10_000),
      ).rejects.toThrow('interrompue');
    });

    it('ne défait pas un règlement payé en ligne', async () => {
      const { service, gestionnaire } = construire({
        mode: ModeReglement.EN_LIGNE,
      });

      await expect(
        service.annulerReglementJustificatif('COT-1', 10_000),
      ).rejects.toThrow('payé en ligne');
      expect(gestionnaire.decrement).not.toHaveBeenCalled();
    });

    it('ne fait rien pour une référence qui n’est pas un règlement', async () => {
      const { service } = construire({}, false);

      await expect(
        service.annulerReglementJustificatif('?', 1),
      ).resolves.toBeNull();
    });
  });
});
