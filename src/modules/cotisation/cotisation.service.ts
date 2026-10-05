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
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { GenerationService } from '../generation/generation.service';
import { TypeNotification } from '../notification/entities/notification.entity';
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
import {
  CreerCotisationDto,
  DeclarerVersementDto,
  MettreAJourCotisationDto,
  PayerEcheanceDto,
} from './dto/cotisation.dto';
import { EcheancePayable, echeancesPayables } from './echeances';
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

    const concernes = await this.populationVisee(cotisation.cibles);

    if (concernes.length > 0) {
      const dejaInscrits = await this.participations.find({
        where: {
          cotisation: { id },
          user: { id: In(concernes.map((personne) => personne.id)) },
        },
        relations: { user: true },
      });
      const connus = new Set(dejaInscrits.map((p) => p.user.id));

      const nouvelles = concernes
        .filter((personne) => !connus.has(personne.id))
        .map((personne) =>
          this.participations.create({
            cotisation,
            user: personne,
            montantDu: cotisation.montantTotal,
            montantRegle: 0,
          }),
        );

      if (nouvelles.length > 0) {
        await this.participations.save(nouvelles);

        // Seules les personnes nouvellement appelées sont prévenues : rouvrir
        // une cotisation ne doit pas renvoyer l'appel à ceux qui l'ont déjà
        // reçu, et parfois déjà réglé.
        await this.notificationService.notifierPlusieurs(
          nouvelles.map((p) => p.user),
          {
            type: TypeNotification.PAIEMENT,
            titre: `Cotisation ouverte : ${cotisation.titre}`,
            message: this.messageOuverture(cotisation),
            lien: '/mon-espace/cotisations',
          },
        );
      }
    }

    await this.cotisations.update(id, { statut: StatutCotisation.OUVERTE });

    this.logger.log(
      `Cotisation « ${cotisation.titre} » ouverte : ${concernes.length} personne(s) concernée(s).`,
    );

    return this.trouver(id);
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

    return participations.map((participation) => {
      const siens = reglements.filter(
        (r) => r.participation.id === participation.id,
      );
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
    });
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
    const participation = await this.sienne(user.id, participationId);
    const echeance = await this.echeanceChoisie(
      participation,
      dto.ordreTranche ?? null,
    );
    const frais = calculerFrais(
      echeance.montant,
      dto.methodePaiement,
      this.tauxFrais,
    );
    const reference = this.genererReference();

    const reglement = await this.reglements.save(
      this.reglements.create({
        participation,
        ordreTranche: echeance.ordreTranche,
        libelle: echeance.libelle,
        montant: echeance.montant,
        montantDebite: frais.montantTtc,
        reference,
        mode: ModeReglement.EN_LIGNE,
        statut: StatutPaiement.EN_ATTENTE,
      }),
    );

    // Ouverte **avant** l'appel au prestataire : un webhook arrivant pendant
    // l'attente de sa réponse trouve ainsi une ligne à mettre à jour.
    await this.transactionService.ouvrir({
      reference,
      montant: frais.montantTtc,
      origine: OrigineTransaction.COTISATION,
      user: participation.user,
      methodePaiement: dto.methodePaiement ?? null,
      fraisPrestataire: frais.fraisFapshi,
    });

    try {
      const resultat = await this.paiement.initier({
        reference,
        montant: frais.montantTtc,
        methode: dto.methodePaiement ?? null,
        telephone: dto.telephone ?? null,
        description: `Cotisation — ${participation.cotisation.titre} — ${echeance.libelle}`,
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
  ): Promise<ReglementPrepare> {
    const participation = await this.sienne(user.id, participationId);

    if (!participation.cotisation.accepteJustificatif) {
      throw new ConflictException(
        'Cette cotisation se règle en ligne : elle n’accepte pas de justificatif.',
      );
    }

    const echeance = await this.echeanceChoisie(participation, ordreTranche);
    const reference = this.genererReference();

    await this.reglements.save(
      this.reglements.create({
        participation,
        ordreTranche: echeance.ordreTranche,
        libelle: echeance.libelle,
        montant: echeance.montant,
        montantDebite: null,
        reference,
        mode: ModeReglement.JUSTIFICATIF,
        statut: StatutPaiement.EN_ATTENTE,
      }),
    );

    await this.transactionService.ouvrir({
      reference,
      montant: echeance.montant,
      origine: OrigineTransaction.COTISATION,
      user: participation.user,
      methodePaiement: null,
      fraisPrestataire: 0,
    });

    return {
      reference,
      libelle: `${participation.cotisation.titre} — ${echeance.libelle}`,
    };
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
      relations: { participation: { cotisation: true, user: true } },
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
      const reste = Math.max(0, apres.montantDu - apres.montantRegle);

      await this.notificationService.notifier({
        destinataire: participation.user,
        type: TypeNotification.PAIEMENT,
        titre: `Règlement reçu : ${titre}`,
        message:
          `Votre règlement de ${montantLisible(credit)} (${reglement.libelle}) ` +
          'a bien été reçu. ' +
          (reste === 0
            ? 'Votre cotisation est entièrement soldée. Merci !'
            : `Il vous reste ${montantLisible(reste)} à verser.`),
        lien: '/mon-espace/cotisations',
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
        lien: '/mon-espace/cotisations',
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

  /** Avancement et échéances réglables d'une participation. */
  private situation(
    participation: ParticipationCotisation,
    reglements: Pick<ReglementCotisation, 'statut'>[],
  ): { avancement: Avancement; echeances: EcheancePayable[] } {
    const { cotisation } = participation;
    const avancement = calculerAvancement(
      participation.montantDu,
      participation.montantRegle,
      cotisation.tranches ?? [],
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
          reglementEnAttente: reglements.some(
            (r) => r.statut === StatutPaiement.EN_ATTENTE,
          ),
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

  /** L'échéance choisie, si elle est réglable maintenant. */
  private async echeanceChoisie(
    participation: ParticipationCotisation,
    ordreTranche: number | null,
  ): Promise<EcheancePayable> {
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
        'Cette échéance n’est pas à régler : elle est soldée ou n’existe pas.',
      );
    }
    if (!echeance.payable) {
      throw new ConflictException(echeance.motif);
    }

    return echeance;
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
