import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  paginer,
  PaginationDto,
  ResultatPagine,
} from '../../common/pagination';
import { Retrait } from '../paiement/entities/retrait.entity';
import { ReleveSolde } from '../paiement/entities/releve-solde.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import {
  SourceRetrait,
  StatutPaiement,
  StatutRetrait,
} from '../paiement/enums/paiement.enum';
import {
  PASSERELLE_PAIEMENT,
  type PasserellePaiement,
  RetraitFournisseur,
} from '../paiement/ports/passerelle-paiement';
import { EtatSolde } from './dto/solde.dto';

/** Au-delà, le solde affiché est relu chez le prestataire à l'ouverture. */
const FRAICHEUR_MS = 5 * 60_000;

/**
 * Durée pendant laquelle un manque doit persister avant d'être constaté.
 *
 * Deux lectures consécutives, espacées d'au moins ce délai : une seule lecture
 * peut tomber entre la confirmation d'un paiement chez nous et son crédit chez
 * Fapshi, et ferait inventer une sortie.
 */
const DELAI_CONSTAT_MS = 5 * 60_000;

/**
 * Manque minimal pour être constaté.
 *
 * Fapshi arrondit ses frais autrement que nous : quelques francs d'écart par
 * paiement sont normaux et ne sont pas une sortie. 100 FCFA est aussi le
 * montant minimal d'un retrait chez Fapshi — rien de plus petit n'a pu sortir.
 */
const SEUIL_CONSTAT = 100;

/** Une photographie du solde au moins par jour, même si rien n'a bougé. */
const PHOTO_QUOTIDIENNE_MS = 24 * 3_600_000;

/**
 * Recul pris à chaque lecture : un retrait « en cours » aboutit ou échoue
 * après coup, et ce recul le fait relire jusqu'à son issue.
 */
const RECUL_MS = 7 * 24 * 3_600_000;

/** Si aucune transaction n'a encore eu lieu, on remonte d'autant. */
const FENETRE_INITIALE_MS = 30 * 24 * 3_600_000;

/**
 * Solde du compte chez le prestataire, et retraits qui l'ont fait baisser.
 *
 * Un retrait se fait dans l'espace de Fapshi, hors de cette application. Sans
 * ce service, le bureau voyait un « encaissé net » qui ne baissait jamais, et
 * un solde réel à zéro après un retrait, sans aucun moyen de relier l'un à
 * l'autre. Ici, le solde se lit chez Fapshi, les retraits s'y relisent un à
 * un, et l'**écart** entre ce que nous avons encaissé et ce qui reste est
 * affiché plutôt que masqué — c'est lui qui trahit un paiement hors
 * application, des frais de retrait ou une erreur.
 */
@Injectable()
export class SoldeService {
  private readonly logger = new Logger(SoldeService.name);

  /** Une seule synchronisation à la fois : les appels simultanés la partagent. */
  private enCours: Promise<ReleveSolde> | null = null;

  constructor(
    @InjectRepository(Retrait)
    private readonly retraits: Repository<Retrait>,
    @InjectRepository(ReleveSolde)
    private readonly releves: Repository<ReleveSolde>,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly passerelle: PasserellePaiement,
  ) {}

  /** Relit le solde et les retraits chez le prestataire. */
  synchroniser(): Promise<ReleveSolde> {
    if (!this.enCours) {
      this.enCours = this.lire().finally(() => {
        this.enCours = null;
      });
    }
    return this.enCours;
  }

  /**
   * Toutes les dix minutes : un retrait fait dans l'espace de Fapshi doit
   * apparaître sans que personne ouvre la page. Un échec est journalisé et
   * n'interrompt rien — la lecture suivante rattrape.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async synchroniserPeriodiquement(): Promise<void> {
    try {
      await this.synchroniser();
    } catch (erreur) {
      this.logger.warn(
        `Synchronisation du solde impossible : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }

  /**
   * État affiché au bureau.
   *
   * Relit chez le prestataire quand la dernière lecture date, mais ne fait
   * jamais échouer l'écran pour autant : à défaut, on rend la dernière valeur
   * connue, marquée obsolète — un chiffre daté vaut mieux qu'une page vide.
   */
  async etat(): Promise<EtatSolde> {
    let releve = await this.dernierReleve();
    let obsolete = false;

    if (!releve || Date.now() - releve.verifieLe.getTime() > FRAICHEUR_MS) {
      try {
        releve = await this.synchroniser();
      } catch (erreur) {
        if (!releve) {
          throw erreur;
        }
        obsolete = true;
        this.logger.warn(
          `Solde affiché sans relecture : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }

    const enCours = await this.sommeRetraits(StatutRetrait.EN_COURS);
    // Un retrait en cours a déjà quitté le compte : l'attendre dans le solde
    // ferait afficher un écart tant qu'il n'a pas abouti.
    const attendu = releve.encaisseNet - releve.retraitsReussis - enCours;

    return {
      soldeFapshi: releve.soldeFapshi,
      devise: releve.devise,
      encaisseNet: releve.encaisseNet,
      retraitsReussis: releve.retraitsReussis,
      retraitsEnCours: enCours,
      soldeAttendu: attendu,
      ecart: releve.soldeFapshi - attendu,
      verifieLe: releve.verifieLe,
      obsolete,
    };
  }

  async lister(pagination: PaginationDto): Promise<ResultatPagine<Retrait>> {
    return paginer(
      await this.retraits.findAndCount({
        order: { initieLe: 'DESC' },
        skip: pagination.sauter,
        take: pagination.limite,
      }),
      pagination,
    );
  }

  /** Photographies du solde, de la plus récente à la plus ancienne. */
  historique(limite: number): Promise<ReleveSolde[]> {
    return this.releves.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limite, 1), 200),
    });
  }

  /**
   * Consigne le motif d'un retrait.
   *
   * Seule écriture permise sur un retrait : le montant, la date et le statut
   * viennent du prestataire et ne se corrigent pas ici.
   */
  async annoter(id: string, note: string | null): Promise<Retrait | null> {
    const retrait = await this.retraits.findOneBy({ id });
    if (!retrait) {
      return null;
    }
    retrait.note = note?.trim() ? note.trim() : null;
    return this.retraits.save(retrait);
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private async lire(): Promise<ReleveSolde> {
    const solde = await this.passerelle.consulterSolde();
    const trouves = await this.passerelle.listerRetraits(
      await this.debutDeFenetre(),
      new Date(),
    );

    await this.enregistrer(trouves);

    const encaisseNet = await this.encaisseNet();
    const precedent = await this.dernierReleve();
    const maintenant = new Date();

    // Le manque : ce que le compte devrait contenir, moins ce qu'il contient.
    let reussis = await this.sommeRetraits(StatutRetrait.REUSSI);
    const enCours = await this.sommeRetraits(StatutRetrait.EN_COURS);
    const manque = encaisseNet - reussis - enCours - solde.solde;

    let manqueDepuis: Date | null = null;

    if (manque >= SEUIL_CONSTAT) {
      manqueDepuis = precedent?.manqueDepuis ?? maintenant;

      if (maintenant.getTime() - manqueDepuis.getTime() >= DELAI_CONSTAT_MS) {
        await this.constater(manque, manqueDepuis, maintenant);
        reussis = await this.sommeRetraits(StatutRetrait.REUSSI);
        manqueDepuis = null;
      }
    }

    return this.photographier(
      {
        soldeFapshi: solde.solde,
        devise: solde.devise,
        encaisseNet,
        retraitsReussis: reussis,
      },
      manqueDepuis,
    );
  }

  /**
   * Consigne une baisse du solde que rien n'explique.
   *
   * Le service dont l'application détient les clés n'est pas le compte
   * principal de Fapshi : pour retirer, il faut d'abord transférer les fonds
   * du service vers ce compte, puis retirer depuis lui. Ni le transfert ni le
   * retrait ne passent par l'API du service. L'application ne peut donc pas
   * les relire ; elle constate la baisse, la garde, et laisse le bureau y
   * consigner le motif.
   */
  private async constater(
    montant: number,
    vuLe: Date,
    constateLe: Date,
  ): Promise<void> {
    await this.retraits.save(
      this.retraits.create({
        referenceExterne: `constate-${constateLe.getTime()}`,
        source: SourceRetrait.CONSTATEE,
        montant,
        statut: StatutRetrait.REUSSI,
        operateur: null,
        beneficiaire: null,
        motif: null,
        referenceFinanciere: null,
        initieLe: vuLe,
        confirmeLe: constateLe,
      }),
    );
    this.logger.warn(
      `Baisse du solde constatée : ${montant} FCFA sans retrait relevé chez Fapshi.`,
    );
  }

  /**
   * Point de départ de la lecture des retraits.
   *
   * La première fois, on remonte à la première transaction : rien d'antérieur
   * ne peut avoir été financé par cette application. Ensuite, on reprend peu
   * avant le dernier retrait connu, et plus tôt encore s'il en reste un en
   * cours, qu'il faut relire jusqu'à son issue.
   */
  private async debutDeFenetre(): Promise<Date> {
    const dernier = await this.retraits.findOne({
      where: {},
      order: { initieLe: 'DESC' },
    });

    if (!dernier) {
      const premiere = await this.transactions.findOne({
        where: {},
        order: { createdAt: 'ASC' },
      });
      return new Date(
        premiere
          ? premiere.createdAt.getTime() - 24 * 3_600_000
          : Date.now() - FENETRE_INITIALE_MS,
      );
    }

    const enCours = await this.retraits.findOne({
      where: { statut: StatutRetrait.EN_COURS },
      order: { initieLe: 'ASC' },
    });
    const reprise = Math.min(
      dernier.initieLe.getTime() - RECUL_MS,
      enCours ? enCours.initieLe.getTime() - 24 * 3_600_000 : Infinity,
    );

    return new Date(reprise);
  }

  /**
   * Écrit les retraits relevés, sans toucher à `note`.
   *
   * `upsert` ne met à jour que les colonnes fournies : la note, absente de
   * l'objet, survit à chaque synchronisation.
   */
  private async enregistrer(trouves: RetraitFournisseur[]): Promise<void> {
    if (trouves.length === 0) {
      return;
    }

    await this.retraits.upsert(
      trouves.map((retrait) => ({ ...retrait })),
      {
        conflictPaths: ['referenceExterne'],
        skipUpdateIfNoValuesChanged: true,
      },
    );
  }

  /**
   * Encaissé net : débité moins frais du prestataire, sur les paiements
   * **passés par Fapshi** seulement. Un règlement reconnu sur justificatif n'a
   * pas de référence externe : l'argent n'a pas transité par le compte, et le
   * compter ferait croire à un solde manquant.
   */
  private async encaisseNet(): Promise<number> {
    const brut = await this.transactions
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.montant - t.frais_prestataire), 0)', 'somme')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE })
      .andWhere('t.reference_externe IS NOT NULL')
      .getRawOne<{ somme: string }>();

    return Number(brut?.somme ?? 0);
  }

  private async sommeRetraits(statut: StatutRetrait): Promise<number> {
    const brut = await this.retraits
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.montant), 0)', 'somme')
      .where('r.statut = :statut', { statut })
      .getRawOne<{ somme: string }>();

    return Number(brut?.somme ?? 0);
  }

  private dernierReleve(): Promise<ReleveSolde | null> {
    return this.releves.findOne({ where: {}, order: { createdAt: 'DESC' } });
  }

  /**
   * Ajoute une photographie si quelque chose a changé, ou si la dernière date
   * d'un jour ; sinon, avance seulement `verifieLe`.
   */
  private async photographier(
    donnees: Omit<
      ReleveSolde,
      'id' | 'createdAt' | 'updatedAt' | 'verifieLe' | 'manqueDepuis'
    >,
    manqueDepuis: Date | null,
  ): Promise<ReleveSolde> {
    const maintenant = new Date();
    const dernier = await this.dernierReleve();

    const inchange =
      dernier !== null &&
      dernier.soldeFapshi === donnees.soldeFapshi &&
      dernier.encaisseNet === donnees.encaisseNet &&
      dernier.retraitsReussis === donnees.retraitsReussis &&
      dernier.devise === donnees.devise &&
      maintenant.getTime() - dernier.createdAt.getTime() < PHOTO_QUOTIDIENNE_MS;

    if (dernier && inchange) {
      dernier.verifieLe = maintenant;
      dernier.manqueDepuis = manqueDepuis;
      return this.releves.save(dernier);
    }

    return this.releves.save(
      this.releves.create({ ...donnees, verifieLe: maintenant, manqueDepuis }),
    );
  }
}
