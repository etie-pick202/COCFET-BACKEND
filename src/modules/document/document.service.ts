import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { Commande } from '../commande/entities/commande.entity';
import type { Stockage } from '../file/ports/stockage';
import { STOCKAGE } from '../file/ports/stockage';
import { IdentiteVisuelleService } from '../generation/identite-visuelle.service';
import { GenerationService } from '../generation/generation.service';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { PeriodeDto } from '../tableau-de-bord/dto/tableau-de-bord.dto';
import { TresorerieService } from '../tableau-de-bord/tresorerie.service';
import { User } from '../user/entities/user.entity';
import {
  CharteFigee,
  ContenuDocument,
  TitulaireFige,
} from './entities/contenu-document';
import { Document, TypeDocument } from './entities/document.entity';
import { composer } from './pdf/rendu';

/**
 * Au-delà, le fichier est purgé. La ligne, elle, ne l'est jamais.
 *
 * Trois mois couvrent le délai pendant lequel une pièce est effectivement
 * rouverte — une réclamation, un remboursement, un rapprochement de fin de
 * trimestre. Après, le PDF se régénère à l'identique depuis le contenu figé :
 * on gagne le stockage sans perdre la pièce.
 */
const RETENTION_MOIS = 3;

/** Préfixe de stockage des PDF. */
const PREFIXE = 'documents';

/** Série de numérotation, par type de document. */
const SEQUENCES: Record<TypeDocument, { sequence: string; prefixe: string }> = {
  [TypeDocument.FACTURE_COMMANDE]: {
    sequence: 'documents_facture_seq',
    prefixe: 'FAC',
  },
  [TypeDocument.RECU_BILLETTERIE]: {
    sequence: 'documents_recu_seq',
    prefixe: 'REC',
  },
  [TypeDocument.RAPPORT_TRESORERIE]: {
    sequence: 'documents_rapport_seq',
    prefixe: 'RAP',
  },
};

/** Qui demande, et à quel titre. */
export interface Demandeur {
  id: string;
  role: Role;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @InjectRepository(Commande)
    private readonly commandes: Repository<Commande>,
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    private readonly identiteVisuelle: IdentiteVisuelleService,
    private readonly generationService: GenerationService,
    private readonly tresorerieService: TresorerieService,
  ) {}

  // ────────────────────────────  Émission  ─────────────────────────────

  /**
   * Facture d'une commande.
   *
   * Refusée tant que le paiement n'a pas abouti : une facture atteste d'un
   * règlement, et en délivrer une pour une commande en attente donnerait à
   * l'acheteur une preuve de ce qu'il n'a pas encore payé.
   */
  async factureCommande(
    commandeId: string,
    demandeur: Demandeur,
  ): Promise<Document> {
    const commande = await this.commandes.findOne({
      where: { id: commandeId },
      relations: { user: true, lignes: { produit: true } },
    });

    if (!commande) {
      throw new NotFoundException('Commande introuvable.');
    }

    this.verifierAcces(commande.user?.id ?? null, demandeur);

    if (commande.statutPaiement !== StatutPaiement.COMPLETE) {
      throw new ConflictException(
        'Cette commande n’est pas réglée : aucune facture ne peut être émise.',
      );
    }

    return this.emettre(
      TypeDocument.FACTURE_COMMANDE,
      commande.id,
      commande.user,
      (charte, emisLe) => ({
        contenu: {
          genre: 'FACTURE_COMMANDE',
          charte,
          emisLe,
          titulaire: this.titulaire(commande.user),
          lignes: (commande.lignes ?? []).map((ligne) => ({
            designation: [
              ligne.produit?.nom ?? 'Article',
              ligne.taille,
              ligne.couleur,
            ]
              .filter(Boolean)
              .join(' · '),
            quantite: ligne.quantite,
            prixUnitaire: ligne.prix,
          })),
          total: commande.total,
          statutPaiement: commande.statutPaiement,
          methodePaiement: commande.methodePaiement,
        },
        titre: `Commande de ${commande.lignes?.length ?? 0} article(s)`,
        montant: commande.total,
      }),
    );
  }

  /** Reçu d'une inscription réglée. */
  async recuBilletterie(
    inscriptionId: string,
    demandeur: Demandeur,
  ): Promise<Document> {
    const inscription = await this.inscriptions.findOne({
      where: { id: inscriptionId },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException('Inscription introuvable.');
    }

    this.verifierAcces(inscription.user?.id ?? null, demandeur);

    if (inscription.statutPaiement !== StatutPaiement.COMPLETE) {
      throw new ConflictException(
        'Cette inscription n’est pas réglée : aucun reçu ne peut être émis.',
      );
    }

    return this.emettre(
      TypeDocument.RECU_BILLETTERIE,
      inscription.id,
      inscription.user,
      (charte, emisLe) => ({
        contenu: {
          genre: 'RECU_BILLETTERIE',
          charte,
          emisLe,
          titulaire: this.titulaire(inscription.user),
          evenement: inscription.evenement?.titre ?? 'Événement',
          dateEvenement: (
            inscription.evenement?.dateDebut ?? inscription.createdAt
          ).toISOString(),
          lieu: inscription.evenement?.lieu ?? 'Non précisé',
          codeBillet: inscription.codeBillet,
          prix: inscription.prix,
          methodePaiement: inscription.methodePaiement,
        },
        titre: `Inscription — ${inscription.evenement?.titre ?? 'Événement'}`,
        montant: inscription.prix,
      }),
    );
  }

  /**
   * Rapport de trésorerie sur une période.
   *
   * Contrairement aux deux autres, il n'est pas idempotent : la source porte
   * l'instant de l'émission. Deux rapports sur la même période **doivent**
   * pouvoir coexister — les chiffres bougent entre-temps, et écraser le
   * premier reviendrait à réécrire un document déjà transmis.
   */
  async rapportTresorerie(
    periode: PeriodeDto,
    demandeur: Demandeur,
  ): Promise<Document> {
    const [tableau, auteur] = await Promise.all([
      this.tresorerieService.tableau(periode),
      this.users.findOne({ where: { id: demandeur.id } }),
    ]);

    const instant = new Date().toISOString();

    return this.emettre(
      TypeDocument.RAPPORT_TRESORERIE,
      `${periode.depuis ?? 'origine'}..${periode.jusqua ?? 'ce-jour'}@${instant}`,
      null,
      (charte, emisLe) => ({
        contenu: {
          genre: 'RAPPORT_TRESORERIE',
          charte,
          emisLe,
          depuis: periode.depuis ?? null,
          jusqua: periode.jusqua ?? null,
          recettesTotales: tableau.recettesTotales,
          transactionsAbouties: tableau.transactionsAbouties,
          transactionsEnAttente: tableau.transactionsEnAttente,
          transactionsEchouees: tableau.transactionsEchouees,
          panierMoyen: tableau.panierMoyen,
          parOrigine: tableau.parOrigine,
          parMethode: tableau.parMethode,
          emisPar: auteur
            ? `${auteur.firstName} ${auteur.lastName}`
            : 'Bureau des Finissants',
        },
        titre: 'Rapport de trésorerie',
        montant: tableau.recettesTotales,
      }),
    );
  }

  // ───────────────────────────  Consultation  ──────────────────────────

  /**
   * Rend les octets du PDF, en le régénérant si le fichier a été purgé.
   *
   * C'est ici que la règle de rétention devient invisible pour l'utilisateur :
   * une facture de l'an dernier se télécharge comme celle d'hier, à une
   * poignée de millisecondes près.
   */
  async fichier(
    id: string,
    demandeur: Demandeur,
  ): Promise<{ document: Document; octets: Buffer }> {
    const document = await this.documents.findOne({
      where: { id },
      relations: { user: true },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable.');
    }

    this.verifierAcces(document.user?.id ?? null, demandeur);

    if (document.cle) {
      try {
        return {
          document,
          octets: await this.stockage.telecharger(document.cle),
        };
      } catch (erreur) {
        // L'objet a disparu du stockage sans passer par la purge. Le contenu
        // figé permet de le refaire : mieux vaut redessiner que rendre 500.
        this.logger.warn(
          `Fichier « ${document.cle} » introuvable pour le document ${document.numero}, régénération : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }

    const octets = await this.dessiner(document);
    await this.ranger(document, octets);

    return { document, octets };
  }

  // ──────────────────────────────  Purge  ──────────────────────────────

  /**
   * Purge les fichiers passés au-delà de la rétention.
   *
   * Une fois par jour : la rétention se compte en mois, une tâche plus
   * fréquente interrogerait la base pour ne rien trouver.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgerLesFichiersAnciens(maintenant = new Date()): Promise<number> {
    const limite = new Date(maintenant);
    limite.setMonth(limite.getMonth() - RETENTION_MOIS);

    const perimes = await this.documents.find({
      where: { cle: Not(IsNull()), createdAt: LessThan(limite) },
      take: 500,
    });

    let purges = 0;

    for (const document of perimes) {
      try {
        await this.stockage.supprimer(document.cle as string);
      } catch (erreur) {
        // L'objet peut déjà être absent. La ligne doit tout de même passer à
        // « purgé », sinon la tâche le représenterait chaque nuit.
        this.logger.warn(
          `Suppression du fichier de ${document.numero} sans effet : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }

      await this.documents.update(document.id, {
        cle: null,
        purgeLe: maintenant,
      });
      purges += 1;
    }

    if (purges > 0) {
      this.logger.log(
        `${purges} fichier(s) de document purgé(s) ; les pièces restent régénérables.`,
      );
    }

    return purges;
  }

  // ────────────────────────────────  Interne  ───────────────────────────

  /**
   * Émet un document, ou rend celui qui existe déjà pour cette source.
   *
   * L'unicité porte sur `(type, source)` : redemander la facture d'une
   * commande rend la même pièce, avec le même numéro. Sans cela, chaque clic
   * en créerait une nouvelle, et deux factures du même achat circuleraient.
   */
  private async emettre(
    type: TypeDocument,
    source: string,
    titulaire: User | null,
    construire: (
      charte: CharteFigee,
      emisLe: string,
    ) => { contenu: ContenuDocument; titre: string; montant: number },
  ): Promise<Document> {
    const existant = await this.documents.findOne({ where: { type, source } });

    if (existant) {
      return existant;
    }

    const charte = await this.charteFigee();
    const { contenu, titre, montant } = construire(
      charte,
      new Date().toISOString(),
    );

    const document = this.documents.create({
      type,
      numero: await this.numeroter(type),
      source,
      user: titulaire,
      titre,
      montant,
      contenu,
      cle: null,
      purgeLe: null,
    });

    const enregistre = await this.documents.save(document);
    await this.ranger(enregistre, await this.dessiner(enregistre));

    return enregistre;
  }

  /** Compose le PDF, logo compris quand le stockage sait le rendre. */
  private async dessiner(document: Document): Promise<Buffer> {
    return composer(
      document.contenu,
      document.numero,
      await this.lireLogo(document.contenu.charte.logo),
    );
  }

  /** Range les octets et retient la clé. Un échec n'annule pas l'émission. */
  private async ranger(document: Document, octets: Buffer): Promise<void> {
    try {
      const cle = await this.stockage.televerser(
        {
          originalname: `${document.numero}.pdf`,
          mimetype: 'application/pdf',
          buffer: octets,
        },
        PREFIXE,
      );

      await this.documents.update(document.id, { cle, purgeLe: null });
      document.cle = cle;
    } catch (erreur) {
      // Le document reste consultable : il sera redessiné au prochain
      // téléchargement, exactement comme après une purge.
      this.logger.warn(
        `PDF de ${document.numero} non rangé, il sera régénéré à la demande : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }

  private async lireLogo(cle: string | null): Promise<Buffer | null> {
    if (!cle) {
      return null;
    }

    try {
      return await this.stockage.telecharger(cle);
    } catch {
      return null;
    }
  }

  /**
   * Numéro de la série, tiré d'une séquence Postgres.
   *
   * Un `COUNT(*) + 1` attribuerait le même numéro à deux émissions
   * simultanées — et l'index unique en ferait échouer une, au moment précis où
   * la boutique est la plus sollicitée. Une séquence ne se trompe jamais, au
   * prix de trous en cas d'échec ultérieur.
   */
  private async numeroter(type: TypeDocument): Promise<string> {
    const { sequence, prefixe } = SEQUENCES[type];
    // Nom de séquence pris dans une table constante, jamais dans une entrée :
    // `nextval` n'accepte pas de paramètre lié, l'interpolation est donc la
    // seule voie et il faut qu'elle ne porte que des littéraux du code.
    const lignes = await this.documents.manager.query<{ valeur: string }[]>(
      `SELECT nextval('${sequence}')::text AS valeur`,
    );

    const annee = new Date().getUTCFullYear();

    return `${prefixe}-${annee}-${lignes[0].valeur.padStart(4, '0')}`;
  }

  /**
   * Charte recopiée dans le document.
   *
   * Le logo y figure par sa **clé**, pas par ses octets : un `jsonb` n'est pas
   * un entrepôt de fichiers, et les octets se relisent au moment de dessiner.
   */
  private async charteFigee(): Promise<CharteFigee> {
    const charte = await this.identiteVisuelle.charte();

    return {
      nom: charte.nom,
      annee: charte.annee,
      couleurPrimaire: charte.couleurPrimaire,
      couleurSecondaire: charte.couleurSecondaire,
      contrastePrimaire: charte.contrastePrimaire,
      logo: await this.cleLogoDuMandat(),
    };
  }

  private async cleLogoDuMandat(): Promise<string | null> {
    try {
      return (await this.generationService.trouverActive())?.logo ?? null;
    } catch {
      return null;
    }
  }

  private titulaire(user: User | null): TitulaireFige {
    return user
      ? { nom: `${user.firstName} ${user.lastName}`, email: user.email }
      : { nom: 'Titulaire inconnu', email: '' };
  }

  /**
   * Un document appartient à son titulaire ; le bureau voit tout.
   *
   * Un titulaire nul désigne une pièce du bureau — un rapport — que seul un
   * administrateur consulte.
   */
  private verifierAcces(
    proprietaire: string | null,
    demandeur: Demandeur,
  ): void {
    if (demandeur.role === Role.ADMIN || proprietaire === demandeur.id) {
      return;
    }

    throw new ForbiddenException('Ce document ne vous appartient pas.');
  }
}
