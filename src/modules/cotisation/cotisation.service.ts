import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { GenerationService } from '../generation/generation.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { NotificationService } from '../notification/notification.service';
import {
  OrigineTransaction,
  Transaction,
} from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import {
  calculerFrais,
  TauxFrais,
  tauxFraisDepuisConfig,
} from '../paiement/frais-paiement';
import {
  PASSERELLE_PAIEMENT,
  type PasserellePaiement,
} from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { User } from '../user/entities/user.entity';
import { Avancement, calculerAvancement } from './avancement';
import { estVise } from './cible';
import {
  CreerCotisationDto,
  DeclarerVersementDto,
  MettreAJourCotisationDto,
  PayerEcheanceDto,
} from './dto/cotisation.dto';
import {
  EcheancePayable,
  echeancesPayables,
  FraisParMethode,
  fraisParMethode,
  montantAutorise,
} from './echeances';
import {
  ModeReglement,
  ReglementCotisation,
} from './entities/reglement-cotisation.entity';
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

/** Ce qu'une personne voit d'une cotisation à laquelle elle est appelée. */
export interface MaCotisation {
  participationId: string;
  cotisation: Cotisation;
  avancement: Avancement;
  /** Échéances réglables, dans l'ordre : prochaine tranche, puis totalité. */
  echeances: EcheancePayable[];
  /** Ses règlements, du plus récent au plus ancien. */
  reglements: ReglementCotisation[];
}

/** Ce qu'il faut pour rattacher un justificatif à une échéance. */
export interface ReglementPrepare {
  reference: string;
  libelle: string;
}

@Injectable()
export class CotisationService {
  private readonly logger = new Logger(CotisationService.name);
  private readonly tauxFrais: TauxFrais;
  /**
   * Une file par participation, pour que deux demandes simultanées ne se
   * partagent pas le même reste.
   *
   * Sans elle, deux clics rapprochés lisaient tous deux « il reste 10 000 » et
   * engageaient chacun 10 000 : la personne aurait pu verser le double de ce
   * qu'elle devait. Le contrôle et l'écriture du règlement se font donc l'un
   * après l'autre, par participation. Suffisant tant que l'API tourne en un
   * seul processus, comme aujourd'hui ; au-delà, il faudrait un verrou en base.
   */
  private readonly verrous = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Cotisation)
    private readonly cotisations: Repository<Cotisation>,
    @InjectRepository(TrancheCotisation)
    private readonly tranches: Repository<TrancheCotisation>,
    @InjectRepository(ParticipationCotisation)
    private readonly participations: Repository<ParticipationCotisation>,
    @InjectRepository(VersementFinance)
    private readonly versements: Repository<VersementFinance>,
    @InjectRepository(ReglementCotisation)
    private readonly reglements: Repository<ReglementCotisation>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly generationService: GenerationService,
    private readonly notificationService: NotificationService,
    private readonly alerteTresorerie: AlerteTresorerieService,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    config: ConfigService,
  ) {
    this.tauxFrais = tauxFraisDepuisConfig(config);
  }

  // ────────────────────────────  Cycle de vie  ──────────────────────────

  async creer(dto: CreerCotisationDto): Promise<Cotisation> {
    this.verifierTranches(dto.montantTotal, dto.tranches ?? []);

    const cotisation = await this.cotisations.save(
      this.cotisations.create({
        titre: dto.titre,
        description: dto.description ?? null,
        montantTotal: dto.montantTotal,
        cibles: dto.cibles,
        dateLimite: dto.dateLimite ? new Date(dto.dateLimite) : null,
        fractionnable: dto.fractionnable ?? false,
        accepteJustificatif: dto.accepteJustificatif ?? false,
        statut: StatutCotisation.BROUILLON,
      }),
    );

    await this.remplacerTranches(cotisation, dto.tranches ?? []);

    return this.trouver(cotisation.id);
  }

  /**
   * Retouche une cotisation **avant** son ouverture.
   *
   * Une fois ouverte, les montants sont figés dans les participations de
   * chacun : les modifier ici ne les changerait pas, et laisserait une
   * cotisation affichant un montant que personne ne doit réellement.
   */
  async mettreAJour(
    id: string,
    dto: MettreAJourCotisationDto,
  ): Promise<Cotisation> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut !== StatutCotisation.BROUILLON) {
      throw new ConflictException(
        'Cette cotisation est ouverte : ses montants sont figés dans les ' +
          'participations. Clôturez-la et relancez-en une autre.',
      );
    }

    const montantTotal = dto.montantTotal ?? cotisation.montantTotal;
    const tranches = dto.tranches;
    if (tranches) {
      this.verifierTranches(montantTotal, tranches);
    }

    await this.cotisations.update(id, {
      ...(dto.titre !== undefined ? { titre: dto.titre } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.montantTotal !== undefined ? { montantTotal } : {}),
      ...(dto.cibles !== undefined ? { cibles: dto.cibles } : {}),
      ...(dto.dateLimite !== undefined
        ? { dateLimite: dto.dateLimite ? new Date(dto.dateLimite) : null }
        : {}),
      ...(dto.fractionnable !== undefined
        ? { fractionnable: dto.fractionnable }
        : {}),
      ...(dto.accepteJustificatif !== undefined
        ? { accepteJustificatif: dto.accepteJustificatif }
        : {}),
    });

    if (tranches) {
      await this.remplacerTranches(cotisation, tranches);
    }

    return this.trouver(id);
  }

  /**
   * Ouvre la cotisation et fige ce que chacun doit.
   *
   * C'est **ce geste** qui crée les participations et y recopie le montant.
   * Le calculer à la lecture ferait qu'une révision du montant rendrait tout
   * le monde rétroactivement en retard, y compris ceux qui avaient soldé.
   *
   * Idempotent sur les personnes déjà inscrites : rouvrir ne duplique rien et
   * n'écrase aucun solde.
   */
  async ouvrir(id: string): Promise<Cotisation> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut === StatutCotisation.CLOSE) {
      throw new ConflictException('Cette cotisation est close.');
    }
    if (cotisation.cibles.length === 0) {
      throw new BadRequestException(
        'Aucune population visée : personne ne serait appelé à verser.',
      );
    }

    const { concernes, nouvelles } = await this.inscrireLesVises(cotisation);

    // Seules les personnes nouvellement appelées sont prévenues : rouvrir une
    // cotisation ne renvoie pas l'appel à ceux qui l'ont déjà reçu.
    if (nouvelles.length > 0) {
      await this.annoncerOuverture(
        cotisation,
        nouvelles.map((p) => p.user),
      );
    }

    await this.cotisations.update(id, { statut: StatutCotisation.OUVERTE });

    this.logger.log(
      `Cotisation « ${cotisation.titre} » ouverte : ${concernes} personne(s) concernée(s).`,
    );

    return this.trouver(id);
  }

  /**
   * Appelle à une cotisation ouverte ceux qui sont arrivés depuis son
   * ouverture.
   *
   * **Être appelé ne dépend pas du jour où l'on s'est inscrit.** Les
   * participations se créaient à l'ouverture seulement : un finissant inscrit
   * une semaine après ne voyait jamais la cotisation des finissants, alors que
   * ses camarades la voyaient. Ce rattrapage tourne chaque heure, pour que la
   * trésorerie voie la liste complète et que les nouveaux soient prévenus ; et
   * la personne elle-même est rattrapée à l'instant où elle consulte ses
   * cotisations (voir `mesCotisations`).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async rattraperLesRetardataires(): Promise<void> {
    const ouvertes = await this.cotisations.find({
      where: { statut: StatutCotisation.OUVERTE },
      relations: { tranches: true },
    });

    for (const cotisation of ouvertes) {
      try {
        await this.rattraper(cotisation);
      } catch (erreur) {
        // Une cotisation en échec ne doit pas priver les autres de leur
        // rattrapage.
        this.logger.error(
          `Rattrapage de « ${cotisation.titre} » impossible : ${(erreur as Error).message}`,
        );
      }
    }
  }

  /** Inscrit les nouveaux visés d'une cotisation ouverte, et les prévient. */
  private async rattraper(cotisation: Cotisation): Promise<void> {
    const { nouvelles } = await this.inscrireLesVises(cotisation);

    if (nouvelles.length > 0) {
      await this.annoncerOuverture(
        cotisation,
        nouvelles.map((p) => p.user),
      );
      this.logger.log(
        `Cotisation « ${cotisation.titre} » : ${nouvelles.length} personne(s) arrivée(s) depuis l'ouverture, appelée(s) à cotiser.`,
      );
    }
  }

  /**
   * Crée la participation de chaque personne visée qui n'en a pas encore.
   *
   * Idempotent : rouvrir ou rattraper ne duplique rien et n'écrase aucun
   * solde. Les nouvelles personnes sont prévenues par `annoncerOuverture`, à
   * part — rouvrir une cotisation ne doit pas renvoyer l'appel à ceux qui l'ont
   * déjà reçu, et parfois déjà réglé.
   */
  private inscrireLesVises(cotisation: Cotisation): Promise<{
    concernes: number;
    nouvelles: ParticipationCotisation[];
  }> {
    // Une file par cotisation : le rattrapage horaire, l'ouverture et la vue
    // de la trésorerie ne s'entrelacent pas sur les mêmes personnes.
    return this.exclusif(`cotisation:${cotisation.id}`, async () => {
      const concernes = await this.populationVisee(cotisation.cibles);

      if (concernes.length === 0) {
        return { concernes: 0, nouvelles: [] };
      }

      const dejaInscrits = await this.participations.find({
        where: {
          cotisation: { id: cotisation.id },
          user: { id: In(concernes.map((personne) => personne.id)) },
        },
        relations: { user: true },
      });
      const connus = new Set(dejaInscrits.map((p) => p.user.id));

      const aCreer = concernes
        .filter((personne) => !connus.has(personne.id))
        .map((personne) =>
          this.participations.create({
            cotisation,
            user: personne,
            montantDu: cotisation.montantTotal,
            montantRegle: 0,
          }),
        );

      return {
        concernes: concernes.length,
        nouvelles: await this.enregistrerSansDoublon(aCreer),
      };
    });
  }

  /**
   * Enregistre des participations en tolérant celles qu'un autre processus
   * vient de créer.
   *
   * L'unicité (cotisation, personne) est garantie par la base : si deux
   * rattrapages se croisent, le second se heurte à la première. On retombe
   * alors sur un enregistrement un par un, en ignorant les doublons, plutôt que
   * de perdre tout le lot pour une seule ligne déjà là.
   */
  private async enregistrerSansDoublon(
    participations: ParticipationCotisation[],
  ): Promise<ParticipationCotisation[]> {
    if (participations.length === 0) {
      return [];
    }

    try {
      await this.participations.save(participations);
      return participations;
    } catch (erreur) {
      if (!estViolationUnicite(erreur)) {
        throw erreur;
      }
    }

    const enregistrees: ParticipationCotisation[] = [];
    for (const participation of participations) {
      try {
        await this.participations.save(participation);
        enregistrees.push(participation);
      } catch (erreur) {
        if (!estViolationUnicite(erreur)) {
          throw erreur;
        }
      }
    }
    return enregistrees;
  }

  /** Prévient des personnes qu'une cotisation les appelle à verser. */
  private annoncerOuverture(
    cotisation: Cotisation,
    personnes: User[],
  ): Promise<number> {
    return this.notificationService.notifierPlusieurs(personnes, {
      type: TypeNotification.PAIEMENT,
      titre: `Cotisation ouverte : ${cotisation.titre}`,
      message: this.messageOuverture(cotisation),
      lien: '/mon-espace/cotisations',
      libelleLien: 'Régler ma cotisation',
    });
  }

  /**
   * Appelle une personne aux cotisations ouvertes qui la visent et qu'elle n'a
   * pas encore.
   *
   * C'est ce qui rend la cotisation visible à qui s'est inscrit après son
   * ouverture, dès sa première consultation : pas d'attente du rattrapage
   * horaire, et pas de dépendance à l'ordre dans lequel les choses se sont
   * passées. Le critère est celui de l'ouverture (voir `estVise`).
   */
  private async rattraperLaPersonne(userId: string): Promise<void> {
    await this.exclusif(`personne:${userId}`, async () => {
      const ouvertes = await this.cotisations.find({
        where: { statut: StatutCotisation.OUVERTE },
        relations: { tranches: true },
      });
      if (ouvertes.length === 0) {
        return;
      }

      const personne = await this.users.findOne({ where: { id: userId } });
      if (!personne) {
        return;
      }

      const existantes = await this.participations.find({
        where: {
          user: { id: userId },
          cotisation: { id: In(ouvertes.map((c) => c.id)) },
        },
        relations: { cotisation: true },
      });
      const connues = new Set(existantes.map((p) => p.cotisation.id));

      const generation = await this.generationService.trouverActive();
      const manquantes = ouvertes.filter(
        (c) =>
          !connues.has(c.id) &&
          estVise(personne, c.cibles, generation?.annee ?? null),
      );

      for (const cotisation of manquantes) {
        const [creee] = await this.enregistrerSansDoublon([
          this.participations.create({
            cotisation,
            user: personne,
            montantDu: cotisation.montantTotal,
            montantRegle: 0,
          }),
        ]);

        // Prévenue une seule fois : seule la création déclenche l'appel.
        if (creee) {
          await this.annoncerOuverture(cotisation, [personne]);
        }
      }
    });
  }

  async clore(id: string): Promise<Cotisation> {
    await this.trouver(id);
    await this.cotisations.update(id, { statut: StatutCotisation.CLOSE });
    return this.trouver(id);
  }

  async supprimer(id: string): Promise<void> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut !== StatutCotisation.BROUILLON) {
      // Effacer une cotisation ouverte emporterait les versements déjà
      // reconnus, et l'argent encaissé n'aurait plus de contrepartie.
      throw new ConflictException(
        'Seule une cotisation en brouillon peut être supprimée.',
      );
    }

    await this.cotisations.delete(id);
  }

  // ─────────────────────────────  Consultation  ─────────────────────────

  lister(): Promise<Cotisation[]> {
    return this.cotisations.find({
      relations: { tranches: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Cotisations auxquelles une personne est appelée : son avancement, les
   * échéances qu'elle peut régler, et ses règlements.
   */
  async mesCotisations(userId: string): Promise<MaCotisation[]> {
    // D'abord rattraper : une cotisation ouverte avant l'arrivée de la
    // personne doit apparaître comme pour les autres.
    await this.rattraperLaPersonne(userId);

    const participations = await this.participations.find({
      where: { user: { id: userId } },
      relations: { cotisation: { tranches: true } },
      order: { createdAt: 'DESC' },
    });

    if (participations.length === 0) {
      return [];
    }

    const reglements = await this.reglements.find({
      where: { participation: { id: In(participations.map((p) => p.id)) } },
      relations: { participation: true },
      order: { createdAt: 'DESC' },
    });

    return participations.map((participation) =>
      this.composerMaCotisation(
        participation,
        reglements.filter((r) => r.participation.id === participation.id),
      ),
    );
  }

  /**
   * Une cotisation de la personne, avec ses échéances et ses règlements.
   *
   * C'est la page de détail : celle où mène l'email, et où la facture de
   * chaque règlement abouti se consulte. Le titulaire fait partie de la
   * recherche — connaître l'identifiant d'une participation ne donne pas accès
   * à celle d'autrui.
   */
  async maCotisation(
    userId: string,
    participationId: string,
  ): Promise<MaCotisation> {
    const participation = await this.sienne(userId, participationId);
    const reglements = await this.reglements.find({
      where: { participation: { id: participationId } },
      relations: { participation: true },
      order: { createdAt: 'DESC' },
    });

    return this.composerMaCotisation(participation, reglements);
  }

  private composerMaCotisation(
    participation: ParticipationCotisation,
    siens: ReglementCotisation[],
  ): MaCotisation {
    return {
      participationId: participation.id,
      cotisation: participation.cotisation,
      ...this.situation(participation, siens),
      // La participation n'a rien à faire dans la réponse : elle est déjà
      // portée par « participationId », et la répéter alourdirait chaque
      // règlement de l'objet qui le contient.
      reglements: siens.map((reglement) => {
        const allege: Partial<ReglementCotisation> = { ...reglement };
        delete allege.participation;
        return allege as ReglementCotisation;
      }),
    };
  }

  async trouver(id: string): Promise<Cotisation> {
    const cotisation = await this.cotisations.findOne({
      where: { id },
      relations: { tranches: true },
    });

    if (!cotisation) {
      throw new NotFoundException("Cette cotisation n'existe pas.");
    }

    return cotisation;
  }

  /** Vue complète, réservée aux finances : qui a versé quoi, qui est en retard. */
  async participationsDe(cotisationId: string): Promise<
    {
      participation: ParticipationCotisation;
      avancement: Avancement;
    }[]
  > {
    const cotisation = await this.trouver(cotisationId);

    // La liste des finances doit être complète : une cotisation ouverte
    // depuis un moment n'a pas à ignorer ceux qui sont arrivés depuis.
    if (cotisation.statut === StatutCotisation.OUVERTE) {
      await this.rattraper(cotisation);
    }

    const participations = await this.participations.find({
      where: { cotisation: { id: cotisationId } },
      relations: { user: true },
    });

    return participations.map((participation) => ({
      participation,
      avancement: calculerAvancement(
        participation.montantDu,
        participation.montantRegle,
        cotisation.tranches ?? [],
      ),
    }));
  }

  // ──────────────────────────────  Règlement  ───────────────────────────

  /**
   * Porte un versement reconnu au solde d'une participation.
   *
   * Appelée par l'aiguillage des paiements : un règlement en ligne et la
   * validation d'une preuve remise en main propre passent par ici, sans se
   * connaître.
   *
   * L'incrément est fait **en base** et non lu puis réécrit : deux règlements
   * simultanés — un paiement en ligne pendant qu'un justificatif est validé —
   * se liraient tous deux avant d'écrire, et le second écraserait le premier.
   */
  async enregistrerReglement(
    participationId: string,
    montant: number,
  ): Promise<void> {
    const participation = await this.participations.findOne({
      where: { id: participationId },
    });

    if (!participation) {
      this.logger.warn(
        `Règlement reçu pour une participation inconnue : ${participationId}`,
      );
      return;
    }

    await this.participations.increment(
      { id: participationId },
      'montantRegle',
      montant,
    );

    const apres = await this.participations.findOneOrFail({
      where: { id: participationId },
    });

    if (
      apres.montantRegle >= apres.montantDu &&
      apres.statut === StatutParticipation.EN_COURS
    ) {
      await this.participations.update(participationId, {
        statut: StatutParticipation.SOLDEE,
      });
    }
  }

  /**
   * Règle une échéance en ligne, par Mobile Money.
   *
   * Le montant crédité est celui de l'échéance ; le payeur est débité de ce
   * montant **plus** les frais du prestataire et la provision de retrait,
   * comme un billet ou une commande — sans quoi chaque cotisation coûterait
   * de l'argent au bureau au lieu d'en recueillir.
   */
  async payerEcheance(
    user: Pick<User, 'id'>,
    participationId: string,
    dto: PayerEcheanceDto,
  ): Promise<ReglementCotisation> {
    // Le contrôle du reste et l'enregistrement du règlement se font d'un
    // bloc : dès qu'il est écrit, il compte comme engagé pour les demandes
    // suivantes. L'appel au prestataire, lui, se fait hors du verrou — il est
    // lent, et n'a rien à protéger.
    const { participation, echeance, montant, frais, reference, reglement } =
      await this.exclusif(participationId, async () => {
        const participation = await this.sienne(user.id, participationId);
        const { echeance, montant } = await this.echeanceChoisie(
          participation,
          dto.ordreTranche ?? null,
          dto.montant,
        );
        const frais = calculerFrais(
          montant,
          dto.methodePaiement,
          this.tauxFrais,
        );
        const reference = this.genererReference();

        const reglement = await this.reglements.save(
          this.reglements.create({
            participation,
            ordreTranche: echeance.ordreTranche,
            libelle: echeance.libelle,
            montant,
            montantDebite: frais.montantTtc,
            reference,
            mode: ModeReglement.EN_LIGNE,
            statut: StatutPaiement.EN_ATTENTE,
          }),
        );

        // Ouverte **avant** l'appel au prestataire : un webhook arrivant
        // pendant l'attente de sa réponse trouve ainsi une ligne à mettre à
        // jour.
        await this.transactionService.ouvrir({
          reference,
          montant: frais.montantTtc,
          origine: OrigineTransaction.COTISATION,
          user: participation.user,
          methodePaiement: dto.methodePaiement ?? null,
          fraisPrestataire: frais.fraisFapshi,
        });

        return {
          participation,
          echeance,
          montant,
          frais,
          reference,
          reglement,
        };
      });

    try {
      const resultat = await this.paiement.initier({
        reference,
        montant: frais.montantTtc,
        methode: dto.methodePaiement ?? null,
        telephone: dto.telephone ?? null,
        description: `Cotisation — ${participation.cotisation.titre} — ${echeance.libelle} (${montant} FCFA)`,
      });

      if (resultat.referenceExterne) {
        await this.transactionService.enregistrerReferenceExterne(
          reference,
          resultat.referenceExterne,
        );
      }

      if (resultat.statut === StatutPaiement.ECHOUE) {
        throw new BadRequestException(
          'Le paiement a été refusé par l’opérateur. Rien ne vous a été débité.',
        );
      }

      if (resultat.urlRedirection) {
        await this.reglements.update(reglement.id, {
          urlPaiement: resultat.urlRedirection,
        });
      }

      // Abouti dès l'appel : aucun webhook ne viendra, l'issue se traite ici.
      if (
        resultat.statut === StatutPaiement.COMPLETE &&
        (await this.transactionService.appliquer(
          reference,
          StatutPaiement.COMPLETE,
        ))
      ) {
        const transaction = await this.transactionService.trouver(reference);
        if (transaction) {
          await this.traiterIssue(transaction, StatutPaiement.COMPLETE);
        }
      }
    } catch (erreur) {
      // Le prestataire n'a pas accepté la demande : la transaction et le
      // règlement sont refermés, sans quoi la personne resterait bloquée
      // derrière un règlement « en attente » qui n'aboutira jamais.
      await this.transactionService.abandonner(reference);
      await this.reglements.update(reglement.id, {
        statut: StatutPaiement.ECHOUE,
        urlPaiement: null,
      });
      throw erreur;
    }

    return this.reglements.findOneOrFail({ where: { id: reglement.id } });
  }

  /**
   * Abandonne un paiement en ligne resté en attente.
   *
   * Sans ce geste, une demande que la personne n'a pas validée sur son
   * téléphone la bloquerait jusqu'à son expiration chez le prestataire :
   * aucune autre échéance n'est réglable tant qu'un règlement attend.
   *
   * La page de paiement est d'abord fermée chez le prestataire, pour que
   * personne ne puisse plus régler sur ce lien. Si le paiement avait malgré
   * tout abouti, sa notification le créditera quand même : la transaction
   * repasse de « échoué » à « abouti », et c'est ce changement qui déclenche
   * le crédit.
   */
  async abandonnerReglement(
    user: Pick<User, 'id'>,
    reglementId: string,
  ): Promise<void> {
    const reglement = await this.reglements.findOne({
      where: { id: reglementId, participation: { user: { id: user.id } } },
    });

    if (!reglement) {
      throw new NotFoundException('Ce règlement n’existe pas.');
    }
    if (reglement.statut !== StatutPaiement.EN_ATTENTE) {
      throw new ConflictException('Ce règlement est déjà tranché.');
    }
    if (reglement.mode !== ModeReglement.EN_LIGNE) {
      throw new ConflictException(
        'Un justificatif en attente se tranche par la trésorerie, pas par son déposant.',
      );
    }

    const transaction = await this.transactionService.trouver(
      reglement.reference,
    );
    if (transaction?.referenceExterne) {
      try {
        await this.paiement.expirer(transaction.referenceExterne);
      } catch (erreur) {
        this.logger.warn(
          `Lien de paiement ${reglement.reference} non expiré : ${(erreur as Error).message}`,
        );
      }
    }

    await this.transactionService.appliquer(
      reglement.reference,
      StatutPaiement.ECHOUE,
    );
    await this.reglements.update(reglement.id, {
      statut: StatutPaiement.ECHOUE,
      urlPaiement: null,
    });
  }

  /**
   * Ouvre le règlement d'une échéance que la personne a payée hors ligne.
   *
   * Appelée au dépôt d'un justificatif : c'est ce qui permet de rattacher la
   * preuve à une échéance choisie, au lieu d'exiger une référence que seul le
   * bureau connaissait. La transaction est ouverte sans frais — l'argent ne
   * passe pas par le prestataire — et attend la décision de la trésorerie.
   */
  async preparerJustificatif(
    user: Pick<User, 'id'>,
    participationId: string,
    ordreTranche: number | null,
    montantDeclare?: number,
  ): Promise<ReglementPrepare> {
    return this.exclusif(participationId, async () => {
      const participation = await this.sienne(user.id, participationId);

      if (!participation.cotisation.accepteJustificatif) {
        throw new ConflictException(
          'Cette cotisation se règle en ligne : elle n’accepte pas de justificatif.',
        );
      }

      // Le montant déclaré est ce que la personne dit avoir versé : il est
      // contrôlé comme un paiement en ligne — jamais plus que ce qui reste sur
      // l'échéance — et la trésorerie certifie ensuite ce qu'elle a vraiment
      // reçu, qui est ce qui sera crédité.
      const { echeance, montant } = await this.echeanceChoisie(
        participation,
        ordreTranche,
        montantDeclare,
      );
      const reference = this.genererReference();

      await this.reglements.save(
        this.reglements.create({
          participation,
          ordreTranche: echeance.ordreTranche,
          libelle: echeance.libelle,
          montant,
          montantDebite: null,
          reference,
          mode: ModeReglement.JUSTIFICATIF,
          statut: StatutPaiement.EN_ATTENTE,
        }),
      );

      await this.transactionService.ouvrir({
        reference,
        montant,
        origine: OrigineTransaction.COTISATION,
        user: participation.user,
        methodePaiement: null,
        fraisPrestataire: 0,
      });

      return {
        reference,
        libelle: `${participation.cotisation.titre} — ${echeance.libelle}`,
      };
    });
  }

  /**
   * Ce que coûterait un paiement en ligne de ce montant, par opérateur.
   *
   * Le montant étant libre, les frais ne se connaissent plus d'avance : la
   * personne les voit se recalculer pendant qu'elle saisit, avec la même
   * formule que celle qui fixera le débit.
   */
  fraisPour(montant: number): FraisParMethode {
    return fraisParMethode(montant, this.tauxFrais);
  }

  /**
   * Défait un règlement préparé dont le justificatif n'a pas pu être déposé.
   *
   * Sans cela, la personne resterait bloquée derrière un règlement « en
   * attente » qu'aucune pièce ne viendra jamais trancher.
   */
  async annulerPreparation(reference: string): Promise<void> {
    await this.transactionService.abandonner(reference);
    await this.reglements.update(
      { reference, statut: StatutPaiement.EN_ATTENTE },
      { statut: StatutPaiement.ECHOUE },
    );
  }

  /**
   * Applique l'issue d'un paiement de cotisation, d'où qu'elle vienne.
   *
   * Appelée par l'aiguillage des paiements — notification du prestataire ou
   * décision de la trésorerie — une fois la transaction passée à son nouvel
   * état, ce qui garantit qu'une même issue n'est jamais appliquée deux fois.
   *
   * Le crédit est le montant de l'échéance pour un paiement en ligne (les
   * frais ne sont pas dus au bureau), et le montant certifié par la
   * trésorerie pour un justificatif : c'est ce qui a réellement été reçu.
   */
  async traiterIssue(
    transaction: Transaction,
    statut: StatutPaiement,
    motif?: string,
  ): Promise<void> {
    const reglement = await this.reglements.findOne({
      where: { reference: transaction.reference },
      relations: {
        participation: { cotisation: { tranches: true }, user: true },
      },
    });

    if (!reglement) {
      // Ancien régime : la référence était l'identifiant de la participation.
      if (statut === StatutPaiement.COMPLETE) {
        await this.enregistrerReglement(
          transaction.reference,
          transaction.montant,
        );
      }
      return;
    }

    const { participation } = reglement;
    const titre = participation.cotisation.titre;

    if (statut === StatutPaiement.COMPLETE) {
      const credit =
        reglement.mode === ModeReglement.JUSTIFICATIF
          ? transaction.montant
          : reglement.montant;

      await this.reglements.update(reglement.id, {
        statut: StatutPaiement.COMPLETE,
        montant: credit,
        urlPaiement: null,
      });
      await this.enregistrerReglement(participation.id, credit);

      const apres = await this.participations.findOneOrFail({
        where: { id: participation.id },
      });
      const avancement = calculerAvancement(
        apres.montantDu,
        apres.montantRegle,
        participation.cotisation.tranches ?? [],
      );

      await this.notificationService.notifier({
        destinataire: participation.user,
        type: TypeNotification.PAIEMENT,
        titre: `Règlement reçu : ${titre}`,
        message:
          `Votre règlement de ${montantLisible(credit)} (${reglement.libelle}) ` +
          'a bien été reçu. ' +
          this.bilanApresReglement(reglement.ordreTranche, avancement) +
          ' Votre facture est disponible sur la page de la cotisation.',
        // La page de la cotisation : c'est là que la facture de chaque
        // règlement se consulte et se télécharge.
        lien: `/mon-espace/cotisations/${participation.id}`,
        libelleLien: 'Voir ma cotisation et ma facture',
      });

      // Ce qui a été reçu : le débité en ligne (frais compris, que le
      // prestataire a retenus), ou le montant certifié d'un justificatif.
      await this.alerteTresorerie.encaissement({
        origine: 'cotisation',
        payeur: participation.user,
        objet: `« ${titre} » (${reglement.libelle})`,
        montant: transaction.montant,
        fraisPrestataire: transaction.fraisPrestataire,
      });
      return;
    }

    if (statut === StatutPaiement.ECHOUE) {
      await this.reglements.update(reglement.id, {
        statut: StatutPaiement.ECHOUE,
        urlPaiement: null,
      });

      const raison = motif ? ` : ${motif}.` : '.';
      await this.notificationService.notifier({
        destinataire: participation.user,
        type: TypeNotification.PAIEMENT,
        titre: `Règlement non abouti : ${titre}`,
        message:
          reglement.mode === ModeReglement.JUSTIFICATIF
            ? `Votre justificatif (${reglement.libelle}) a été refusé${raison}` +
              ' Vous pouvez en déposer un autre, ou régler en ligne.'
            : `Le paiement de « ${reglement.libelle} » n’a pas abouti. ` +
              'Rien ne vous a été crédité : vous pouvez réessayer.',
        lien: `/mon-espace/cotisations/${participation.id}`,
        libelleLien: 'Voir ma cotisation',
      });
    }
  }

  // ───────────────────────────────  Encaisse  ───────────────────────────

  /**
   * Enregistre la remise au bureau de ce qu'un membre détenait.
   *
   * Déclaratif : la plateforme tient un registre, elle ne remplace ni la
   * confiance ni les comptes du bureau.
   */
  async declarerVersement(
    membre: User,
    dto: DeclarerVersementDto,
  ): Promise<VersementFinance> {
    if (dto.montant <= 0) {
      throw new BadRequestException('Le montant remis doit être positif.');
    }

    const recuPar = dto.recuParId
      ? await this.users.findOne({ where: { id: dto.recuParId } })
      : null;

    return this.versements.save(
      this.versements.create({
        membre,
        montant: dto.montant,
        recuPar,
        note: dto.note ?? null,
      }),
    );
  }

  listerVersements(): Promise<VersementFinance[]> {
    return this.versements.find({
      relations: { membre: true, recuPar: true },
      order: { createdAt: 'DESC' },
    });
  }

  // ─────────────────────────────  Interne  ──────────────────────────────

  /** Ce que dit l'appel à cotiser : combien, jusqu'à quand, comment. */
  private messageOuverture(cotisation: Cotisation): string {
    const echeance = cotisation.dateLimite
      ? ` avant le ${cotisation.dateLimite.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`
      : '';
    const rythme =
      cotisation.fractionnable && (cotisation.tranches?.length ?? 0) > 0
        ? `Vous pouvez régler échéance par échéance (${cotisation.tranches.length} tranches) ou tout en une fois.`
        : 'Le règlement se fait en une fois.';

    return (
      `Le bureau vous appelle à verser ${montantLisible(cotisation.montantTotal)}` +
      `${echeance}. ${rythme} Le paiement se fait directement sur la ` +
      'plateforme, par Orange Money ou MTN MoMo.'
    );
  }

  /**
   * Où en est la personne, dit à la lettre : la tranche réglée, puis le reste.
   *
   * Un versement partiel doit se lire pour ce qu'il est — « 5 000 sur 30 000,
   * 17 % » — et non comme une tranche réglée ou non.
   */
  private bilanApresReglement(
    ordreTranche: number | null,
    avancement: Avancement,
  ): string {
    if (avancement.montantRestant === 0) {
      return 'Votre cotisation est entièrement soldée. Merci !';
    }

    const tranche =
      ordreTranche === null
        ? undefined
        : avancement.tranches.find((t) => t.ordre === ordreTranche);
    let detail = '';
    if (tranche?.soldee) {
      detail = `${tranche.libelle} est soldée. `;
    } else if (tranche) {
      detail =
        `${tranche.libelle} : ${montantLisible(tranche.regle)} sur ` +
        `${montantLisible(tranche.montant)} (${tranche.pourcentage} %). `;
    }

    return (
      `${detail}Cotisation réglée à ${avancement.pourcentage} % : il vous ` +
      `reste ${montantLisible(avancement.montantRestant)} à verser.`
    );
  }

  /**
   * Exécute `tache` à la suite des autres demandes de la même clé.
   *
   * Voir `verrous` : c'est ce qui garantit que le contrôle du reste et
   * l'écriture du règlement ne s'entrelacent pas entre deux demandes.
   */
  private async exclusif<T>(cle: string, tache: () => Promise<T>): Promise<T> {
    const precedent = this.verrous.get(cle) ?? Promise.resolve();
    let liberer: () => void = () => undefined;
    const courant = new Promise<void>((resoudre) => {
      liberer = resoudre;
    });
    const suite = precedent.then(() => courant);
    this.verrous.set(cle, suite);

    await precedent;
    try {
      return await tache();
    } finally {
      liberer();
      // Rien d'autre n'attend : la clé n'a plus lieu de rester en mémoire.
      if (this.verrous.get(cle) === suite) {
        this.verrous.delete(cle);
      }
    }
  }

  /** Avancement et échéances réglables d'une participation. */
  private situation(
    participation: ParticipationCotisation,
    reglements: Pick<ReglementCotisation, 'statut' | 'montant'>[],
  ): { avancement: Avancement; echeances: EcheancePayable[] } {
    const { cotisation } = participation;
    // Ce qui a été lancé mais pas encore reconnu : un justificatif en cours
    // d'examen, un paiement en ligne non validé. Compté comme engagé.
    const enAttente = reglements
      .filter((r) => r.statut === StatutPaiement.EN_ATTENTE)
      .reduce((somme, r) => somme + r.montant, 0);
    const avancement = calculerAvancement(
      participation.montantDu,
      participation.montantRegle,
      cotisation.tranches ?? [],
      new Date(),
      enAttente,
    );

    return {
      avancement,
      echeances: echeancesPayables(
        avancement,
        {
          ouverte:
            cotisation.statut === StatutCotisation.OUVERTE &&
            participation.statut !== StatutParticipation.EXEMPTEE,
          fractionnable: cotisation.fractionnable,
          dateCloture: cotisation.dateLimite,
        },
        this.tauxFrais,
      ),
    };
  }

  /**
   * La participation d'une personne, ou une 404.
   *
   * Le titulaire fait partie de la recherche : connaître l'identifiant d'une
   * participation ne doit pas suffire à payer — ou à justifier — pour autrui.
   */
  private async sienne(
    userId: string,
    participationId: string,
  ): Promise<ParticipationCotisation> {
    const participation = await this.participations.findOne({
      where: { id: participationId, user: { id: userId } },
      relations: { cotisation: { tranches: true }, user: true },
    });

    if (!participation) {
      throw new NotFoundException('Cette participation n’existe pas.');
    }

    return participation;
  }

  /**
   * L'échéance choisie et le montant à y verser, si elle est réglable.
   *
   * Le montant est contrôlé ici, côté serveur : l'écran borne la saisie, mais
   * rien de ce qu'il affiche ne fait foi. Il est calculé sur ce qui reste
   * *hors* règlements déjà engagés, relus à l'instant.
   */
  private async echeanceChoisie(
    participation: ParticipationCotisation,
    ordreTranche: number | null,
    montantDemande?: number,
  ): Promise<{ echeance: EcheancePayable; montant: number }> {
    const enAttente = await this.reglements.find({
      where: {
        participation: { id: participation.id },
        statut: StatutPaiement.EN_ATTENTE,
      },
    });

    const echeance = this.situation(participation, enAttente).echeances.find(
      (e) => e.ordreTranche === ordreTranche,
    );

    if (!echeance) {
      throw new BadRequestException(
        'Cette échéance n’est pas à régler : elle est soldée, déjà couverte ' +
          'par des règlements en attente, ou n’existe pas.',
      );
    }
    if (!echeance.payable) {
      throw new ConflictException(echeance.motif);
    }

    const autorise = montantAutorise(echeance, montantDemande);
    if ('erreur' in autorise) {
      throw new BadRequestException(autorise.erreur);
    }

    return { echeance, montant: autorise.montant };
  }

  /**
   * Référence d'un règlement, qui sert aussi de référence de transaction.
   *
   * Aléatoire plutôt que dérivée de la participation : une même personne
   * règle plusieurs échéances, et la référence est unique par transaction.
   */
  private genererReference(): string {
    return `COT-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  /**
   * Refuse un échéancier qui ne totalise pas le montant dû.
   *
   * Une cotisation dont les tranches ne couvrent pas la somme est une faute de
   * saisie, jamais une configuration : la personne verserait la totalité des
   * tranches sans être à jour, ou serait déclarée soldée en ayant moins versé.
   */
  private verifierTranches(
    montantTotal: number,
    tranches: { montant: number; ordre: number }[],
  ): void {
    if (tranches.length === 0) {
      return;
    }

    const somme = tranches.reduce((total, t) => total + t.montant, 0);
    if (somme !== montantTotal) {
      throw new BadRequestException(
        `Les tranches totalisent ${somme} FCFA pour un montant dû de ${montantTotal} FCFA.`,
      );
    }

    const ordres = new Set(tranches.map((t) => t.ordre));
    if (ordres.size !== tranches.length) {
      // Deux tranches de même rang rendraient leur consommation indéterminée.
      throw new BadRequestException(
        'Deux tranches portent le même ordre : leur enchaînement serait indéterminé.',
      );
    }
  }

  private async remplacerTranches(
    cotisation: Cotisation,
    tranches: CreerCotisationDto['tranches'],
  ): Promise<void> {
    await this.tranches.delete({ cotisation: { id: cotisation.id } });

    if (!tranches?.length) {
      return;
    }

    await this.tranches.save(
      tranches.map((tranche) =>
        this.tranches.create({
          cotisation,
          ordre: tranche.ordre,
          libelle: tranche.libelle,
          montant: tranche.montant,
          dateLimite: new Date(tranche.dateLimite),
        }),
      ),
    );
  }

  /**
   * Traduit les populations visées en personnes réelles.
   *
   * « Finissant » et « alumni » ne sont pas des rôles mais des statuts déduits
   * de la promotion et du mandat en cours : les confondre avec `STUDENT`
   * ferait cotiser les mauvaises personnes.
   */
  private async populationVisee(cibles: CibleCotisation[]): Promise<User[]> {
    const generation = await this.generationService.trouverActive();
    const requete = this.users
      .createQueryBuilder('u')
      .where('u.is_active = true');

    const conditions: string[] = [];
    const parametres: Record<string, unknown> = {};

    if (cibles.includes(CibleCotisation.FINISSANT)) {
      conditions.push('u.is_finissant = true');
    }
    if (cibles.includes(CibleCotisation.ETUDIANT)) {
      conditions.push('u.role = :etudiant');
      parametres.etudiant = Role.STUDENT;
    }
    if (cibles.includes(CibleCotisation.VISITEUR)) {
      conditions.push('u.role = :visiteur');
      parametres.visiteur = Role.VISITOR;
    }
    if (cibles.includes(CibleCotisation.ADMIN)) {
      conditions.push('u.role = :admin');
      parametres.admin = Role.ADMIN;
    }
    if (cibles.includes(CibleCotisation.ALUMNI) && generation) {
      // Alumni : a été étudiant, et sa promotion est derrière le mandat en
      // cours. Sans génération active, la notion n'a pas de repère — la cible
      // est alors ignorée plutôt que devinée.
      conditions.push('(u.promotion IS NOT NULL AND u.promotion < :annee)');
      parametres.annee = generation.annee;
    }

    if (conditions.length === 0) {
      return [];
    }

    return requete
      .andWhere(`(${conditions.join(' OR ')})`, parametres)
      .getMany();
  }
}

/** « 25 000 FCFA », avec l'espace insécable du français. */
function montantLisible(montant: number): string {
  return `${montant.toLocaleString('fr-FR').replace(/\s/g, '\u00a0')}\u00a0FCFA`;
}

/** Violation d'unicité PostgreSQL : la ligne existe déjà. */
function estViolationUnicite(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    ((erreur as { code?: string }).code === '23505' ||
      (erreur as { driverError?: { code?: string } }).driverError?.code ===
        '23505')
  );
}
