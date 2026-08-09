import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { Commande } from '../commande/entities/commande.entity';
import { GenerationService } from '../generation/generation.service';
import { IdentiteVisuelleService } from '../generation/identite-visuelle.service';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { TresorerieService } from '../tableau-de-bord/tresorerie.service';
import { User } from '../user/entities/user.entity';
import { DocumentService } from './document.service';
import { ContenuFacture } from './entities/contenu-document';
import { Document, TypeDocument } from './entities/document.entity';

const AWA = { id: 'user-1', role: Role.STUDENT };
const TRESORIERE = { id: 'user-2', role: Role.ADMIN };

describe('DocumentService', () => {
  let service: DocumentService;

  let documents: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    manager: { query: jest.Mock };
  };
  let commandes: { findOne: jest.Mock };
  let inscriptions: { findOne: jest.Mock };
  let tresorerie: { tableau: jest.Mock };
  let generations: { trouverActive: jest.Mock };
  let stockage: {
    televerser: jest.Mock;
    telecharger: jest.Mock;
    supprimer: jest.Mock;
    urlSignee: jest.Mock;
  };

  const utilisateur = {
    id: AWA.id,
    firstName: 'Awa',
    lastName: 'Ndiaye',
    email: 'awa@exemple.test',
  } as User;

  const commande = (
    statutPaiement = StatutPaiement.COMPLETE,
  ): Partial<Commande> => ({
    id: 'cmd-1',
    user: utilisateur,
    total: 33500,
    statutPaiement,
    methodePaiement: null,
    lignes: [
      {
        quantite: 2,
        prix: 15000,
        taille: 'M',
        couleur: 'Noir',
        produit: { nom: 'Sweat capuche' },
      },
    ] as Commande['lignes'],
  });

  /** Un document déjà émis, tel qu'il revient de la base. */
  const emis = (surcharge: Partial<Document> = {}): Document =>
    ({
      id: 'doc-1',
      type: TypeDocument.FACTURE_COMMANDE,
      numero: 'FAC-2027-0001',
      source: 'cmd-1',
      user: utilisateur,
      titre: 'Commande',
      montant: 33500,
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
      cle: 'documents/abc-FAC-2027-0001.pdf',
      purgeLe: null,
      contenu: {
        genre: 'FACTURE_COMMANDE',
        charte: {
          nom: 'Promotion ATLAS',
          annee: 2027,
          couleurPrimaire: '#123456',
          couleurSecondaire: '#ABCDEF',
          contrastePrimaire: '#FFFFFF',
          logo: null,
        },
        emisLe: '2027-01-01T00:00:00.000Z',
        titulaire: { nom: 'Awa Ndiaye', email: 'awa@exemple.test' },
        lignes: [
          { designation: 'Sweat capuche', quantite: 2, prixUnitaire: 15000 },
        ],
        total: 33500,
        statutPaiement: 'COMPLETE',
        methodePaiement: null,
      } satisfies ContenuFacture,
      ...surcharge,
    }) as Document;

  beforeEach(() => {
    documents = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((valeur: Partial<Document>) => valeur as Document),
      save: jest.fn((valeur: Document) =>
        Promise.resolve({ ...valeur, id: 'doc-1' }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ valeur: '1' }]) },
    };
    commandes = { findOne: jest.fn().mockResolvedValue(commande()) };
    inscriptions = { findOne: jest.fn().mockResolvedValue(null) };
    tresorerie = { tableau: jest.fn() };
    generations = { trouverActive: jest.fn().mockResolvedValue(null) };
    stockage = {
      televerser: jest.fn().mockResolvedValue('documents/nouvelle-cle.pdf'),
      telecharger: jest.fn().mockResolvedValue(Buffer.from('%PDF-range')),
      supprimer: jest.fn().mockResolvedValue(undefined),
      urlSignee: jest.fn(),
    };

    service = new DocumentService(
      documents as unknown as Repository<Document>,
      commandes as unknown as Repository<Commande>,
      inscriptions as unknown as Repository<Inscription>,
      {
        findOne: jest.fn().mockResolvedValue(utilisateur),
      } as unknown as Repository<User>,
      stockage,
      {
        charte: jest.fn().mockResolvedValue({
          nom: 'Promotion ATLAS',
          annee: 2027,
          couleurPrimaire: '#123456',
          couleurSecondaire: '#ABCDEF',
          contrastePrimaire: '#FFFFFF',
          logo: null,
        }),
      } as unknown as IdentiteVisuelleService,
      generations as unknown as GenerationService,
      tresorerie as unknown as TresorerieService,
    );
  });

  describe('émission', () => {
    it('émet la facture d’une commande réglée', async () => {
      const document = await service.factureCommande('cmd-1', AWA);

      // Le millesime est celui de l'emission, le rang vient de la sequence.
      expect(document.numero).toMatch(/^FAC-\d{4}-0001$/);
      expect(document.montant).toBe(33500);
      expect(stockage.televerser).toHaveBeenCalledTimes(1);
    });

    it('rend la même pièce quand on la redemande', async () => {
      // Sans cette idempotence, chaque clic créerait une facture, et deux
      // pièces du même achat circuleraient sous des numéros différents.
      documents.findOne.mockResolvedValue(emis());

      const document = await service.factureCommande('cmd-1', AWA);

      expect(document.numero).toBe('FAC-2027-0001');
      expect(documents.save).not.toHaveBeenCalled();
      expect(stockage.televerser).not.toHaveBeenCalled();
    });

    it('refuse de facturer une commande non réglée', async () => {
      // Une facture atteste d'un règlement : en délivrer une pour une
      // commande en attente donnerait une preuve de ce qui n'est pas payé.
      commandes.findOne.mockResolvedValue(commande(StatutPaiement.EN_ATTENTE));

      await expect(service.factureCommande('cmd-1', AWA)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuse la commande d’un autre compte', async () => {
      await expect(
        service.factureCommande('cmd-1', { id: 'intrus', role: Role.STUDENT }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('laisse le bureau émettre pour autrui', async () => {
      await expect(
        service.factureCommande('cmd-1', TRESORIERE),
      ).resolves.toMatchObject({ type: TypeDocument.FACTURE_COMMANDE });
    });

    it('émet sans image quand le logo du mandat est illisible', async () => {
      // Un logo manquant produit une pièce sans image, ce qui reste
      // préférable à une pièce jamais émise.
      generations.trouverActive.mockResolvedValue({
        logo: 'generations/atlas.png',
      });
      stockage.telecharger.mockRejectedValue(new Error('objet absent'));

      const document = await service.factureCommande('cmd-1', AWA);

      expect(document.contenu.charte.logo).toBe('generations/atlas.png');
      expect(stockage.televerser).toHaveBeenCalledTimes(1);
    });

    it('émet même si la base ne rend pas le mandat', async () => {
      generations.trouverActive.mockRejectedValue(
        new Error('base injoignable'),
      );

      const document = await service.factureCommande('cmd-1', AWA);

      expect(document.contenu.charte.logo).toBeNull();
    });

    it('émet quand même si le rangement du PDF échoue', async () => {
      // Le fichier sera redessiné au prochain téléchargement, exactement comme
      // après une purge. Perdre la pièce serait bien pire.
      stockage.televerser.mockRejectedValue(new Error('stockage injoignable'));

      await expect(
        service.factureCommande('cmd-1', AWA),
      ).resolves.toBeDefined();
    });
  });

  describe('reçu de billetterie', () => {
    const inscription = (statutPaiement = StatutPaiement.COMPLETE) => ({
      id: 'ins-1',
      user: utilisateur,
      evenement: {
        titre: 'Gala des finissants',
        dateDebut: new Date('2027-06-12T19:00:00.000Z'),
        lieu: 'Campus UCAC-ICAM',
      },
      codeBillet: 'BIL-4821',
      prix: 10000,
      methodePaiement: null,
      statutPaiement,
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    it('émet un reçu pour une inscription réglée', async () => {
      inscriptions.findOne.mockResolvedValue(inscription());

      const document = await service.recuBilletterie('ins-1', AWA);

      expect(document.numero).toMatch(/^REC-\d{4}-0001$/);
      expect(document.montant).toBe(10000);
    });

    it('refuse un reçu pour une inscription non réglée', async () => {
      inscriptions.findOne.mockResolvedValue(
        inscription(StatutPaiement.EN_ATTENTE),
      );

      await expect(service.recuBilletterie('ins-1', AWA)).rejects.toThrow(
        ConflictException,
      );
    });

    it('signale une inscription inconnue', async () => {
      await expect(service.recuBilletterie('ins-1', AWA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('retombe sur la date d’inscription si l’événement manque', async () => {
      // Une relation absente ne doit pas empêcher la remise du reçu : le
      // titulaire a payé, la pièce lui est due.
      inscriptions.findOne.mockResolvedValue({
        ...inscription(),
        evenement: null,
      });

      const document = await service.recuBilletterie('ins-1', AWA);

      expect(document.titre).toContain('Événement');
    });
  });

  describe('rapport de trésorerie', () => {
    const chiffres = {
      recettesTotales: 1250000,
      transactionsAbouties: 84,
      transactionsEnAttente: 3,
      transactionsEchouees: 7,
      panierMoyen: 14881,
      parOrigine: [{ libelle: 'BOUTIQUE', montant: 350000, nombre: 24 }],
      parMethode: [{ libelle: 'MOBILE_MONEY', montant: 1250000, nombre: 84 }],
    };

    it('fige les chiffres de la période et nomme l’émetteur', async () => {
      tresorerie.tableau.mockResolvedValue(chiffres);

      const document = await service.rapportTresorerie(
        { depuis: '2027-01-01T00:00:00.000Z' },
        TRESORIERE,
      );

      expect(document.numero).toMatch(/^RAP-/);
      expect(document.montant).toBe(1250000);
      expect(document.contenu).toMatchObject({
        genre: 'RAPPORT_TRESORERIE',
        depuis: '2027-01-01T00:00:00.000Z',
        jusqua: null,
        emisPar: 'Awa Ndiaye',
      });
    });

    it('n’appartient à personne', async () => {
      // Un rapport relève du bureau : la trésorière qui l'émet n'en est pas
      // propriétaire, et il ne doit pas remonter dans ses factures.
      tresorerie.tableau.mockResolvedValue(chiffres);

      const document = await service.rapportTresorerie({}, TRESORIERE);

      expect(document.user).toBeNull();
    });

    it('porte l’instant d’émission dans sa source', async () => {
      // C'est ce qui permet à deux rapports sur la même période de coexister,
      // alors que la facture d'une commande reste unique.
      tresorerie.tableau.mockResolvedValue(chiffres);

      const premier = await service.rapportTresorerie({}, TRESORIERE);
      const second = await service.rapportTresorerie({}, TRESORIERE);

      expect(second.source).not.toBe(premier.source);
    });
  });

  describe('téléchargement', () => {
    it('sert le fichier rangé quand il existe', async () => {
      documents.findOne.mockResolvedValue(emis());

      const { octets } = await service.fichier('doc-1', AWA);

      expect(stockage.telecharger).toHaveBeenCalledWith(
        'documents/abc-FAC-2027-0001.pdf',
      );
      expect(octets.toString()).toBe('%PDF-range');
    });

    it('régénère la pièce purgée, et la range à nouveau', async () => {
      documents.findOne.mockResolvedValue(
        emis({ cle: null, purgeLe: new Date('2027-04-01T00:00:00.000Z') }),
      );

      const { octets } = await service.fichier('doc-1', AWA);

      expect(octets.subarray(0, 4).toString()).toBe('%PDF');
      expect(stockage.telecharger).not.toHaveBeenCalled();
      expect(documents.update).toHaveBeenCalledWith('doc-1', {
        cle: 'documents/nouvelle-cle.pdf',
        purgeLe: null,
      });
    });

    it('redessine plutôt que d’échouer si l’objet a disparu du stockage', async () => {
      documents.findOne.mockResolvedValue(emis());
      stockage.telecharger.mockRejectedValue(new Error('objet absent'));

      const { octets } = await service.fichier('doc-1', AWA);

      expect(octets.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('ne relit jamais le domaine pour redessiner', async () => {
      // C'est toute la garantie du contenu figé : un produit renommé ou un
      // tarif corrigé ne doit pas changer une facture déjà émise.
      documents.findOne.mockResolvedValue(emis({ cle: null }));

      await service.fichier('doc-1', AWA);

      expect(commandes.findOne).not.toHaveBeenCalled();
    });

    it('refuse le document d’un autre compte', async () => {
      documents.findOne.mockResolvedValue(emis());

      await expect(
        service.fichier('doc-1', { id: 'intrus', role: Role.STUDENT }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('purge', () => {
    it('efface le fichier et conserve la ligne', async () => {
      documents.find.mockResolvedValue([emis()]);

      const purges = await service.purgerLesFichiersAnciens(
        new Date('2027-06-01T00:00:00.000Z'),
      );

      expect(purges).toBe(1);
      expect(stockage.supprimer).toHaveBeenCalledWith(
        'documents/abc-FAC-2027-0001.pdf',
      );
      expect(documents.update).toHaveBeenCalledWith('doc-1', {
        cle: null,
        purgeLe: new Date('2027-06-01T00:00:00.000Z'),
      });
    });

    it('marque la ligne même quand le fichier a déjà disparu', async () => {
      // Sinon la tâche représenterait le même document chaque nuit, sans
      // jamais parvenir à le solder.
      documents.find.mockResolvedValue([emis()]);
      stockage.supprimer.mockRejectedValue(new Error('objet absent'));

      await expect(
        service.purgerLesFichiersAnciens(new Date('2027-06-01T00:00:00.000Z')),
      ).resolves.toBe(1);
      expect(documents.update).toHaveBeenCalled();
    });
  });
});
