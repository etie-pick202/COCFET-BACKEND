import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { montantLisible } from '../../common/montant';
import {
  paginer,
  PaginationDto,
  ResultatPagine,
} from '../../common/pagination';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { Retrait } from '../paiement/entities/retrait.entity';
import {
  OrigineTransaction,
  Transaction,
} from '../paiement/entities/transaction.entity';
import { StatutPaiement, StatutRetrait } from '../paiement/enums/paiement.enum';
import { TauxFrais, tauxFraisDepuisConfig } from '../paiement/frais-paiement';
import {
  PASSERELLE_PAIEMENT,
  type PasserellePaiement,
} from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { SoldeService } from '../solde/solde.service';
import { User } from '../user/entities/user.entity';
import {
  DeclarerMouvementDto,
  PocheMembre,
  ResultatMouvement,
  SuiviFonds,
} from './dto/fonds.dto';
import {
  MouvementFonds,
  StatutMouvementFonds,
  TypeMouvementFonds,
} from './entities/mouvement-fonds.entity';
import { calculerPoches, disponible, SommeParMembre } from './poches';

/** Comme les preuves de paiement : au-delà, la pièce jointe est effacée. */
const RETENTION_PIECES_MS = 60 * 24 * 60 * 60 * 1000;

const SORTIES = new Set<TypeMouvementFonds>([
  TypeMouvementFonds.TRANSFERT,
  TypeMouvementFonds.DEPOT_PLATEFORME,
  TypeMouvementFonds.REMBOURSEMENT,
  TypeMouvementFonds.DEPENSE,
]);

const LIBELLES: Record<TypeMouvementFonds, string> = {
  [TypeMouvementFonds.RECEPTION]: 'une réception',
  [TypeMouvementFonds.TRANSFERT]: 'un transfert',
  [TypeMouvementFonds.DEPOT_PLATEFORME]: 'un dépôt sur la plateforme',
  [TypeMouvementFonds.REMBOURSEMENT]: 'un remboursement',
  [TypeMouvementFonds.DEPENSE]: 'une dépense',
};

type DonneesCommunes = Pick<
  MouvementFonds,
  | 'type'
  | 'membre'
  | 'declarePar'
  | 'contrepartie'
  | 'montant'
  | 'note'
  | 'piece'
>;

/**
 * Où est l'argent du bureau.
 *
 * Fapshi sait ce qu'il y a sur la plateforme ; tout le reste est dans des
 * mains. Ce service tient le registre des déplacements entre les deux, et en
 * déduit à tout moment ce que chaque membre détient — sans jamais mélanger
 * « sur le compte Fapshi » et « dans la poche de X ».
 *
 * Déclaratif : la plateforme tient un registre, elle ne remplace ni la
 * confiance ni les comptes. Seul le **dépôt sur la plateforme** est vérifié —
 * parce qu'il passe par Fapshi, qui en atteste.
 */
@Injectable()
export class FondsService {
  private readonly logger = new Logger(FondsService.name);
  private readonly tauxFrais: TauxFrais;
  /** Sérialise les déclarations : deux sorties simultanées ne doivent pas dépasser la poche. */
  private file: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(MouvementFonds)
    private readonly mouvements: Repository<MouvementFonds>,
    @InjectRepository(Retrait)
    private readonly retraits: Repository<Retrait>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly solde: SoldeService,
    private readonly transactionService: TransactionService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    private readonly notificationService: NotificationService,
    private readonly alerteTresorerie: AlerteTresorerieService,
    private readonly nettoyage: NettoyageFichiers,
    config: ConfigService,
  ) {
    this.tauxFrais = tauxFraisDepuisConfig(config);
  }

  // ───────────────────────────────  Lecture  ────────────────────────────

  async suivi(): Promise<SuiviFonds> {
    const etat = await this.solde.etat();
    const poches = await this.poches();
    const totalPoches = poches.reduce((somme, p) => somme + p.detient, 0);

    const [nonAttribue] = await this.mouvements.manager.query<
      { somme: string; nombre: string }[]
    >(
      `SELECT COALESCE(SUM(montant), 0) AS somme, COUNT(*) AS nombre
       FROM retraits WHERE statut = $1 AND detenteur_id IS NULL`,
      [StatutRetrait.REUSSI],
    );
    const [frais] = await this.mouvements.manager.query<{ somme: string }[]>(
      `SELECT COALESCE(SUM(frais_prestataire), 0) AS somme
       FROM mouvements_fonds WHERE type = $1 AND statut = $2`,
      [TypeMouvementFonds.DEPOT_PLATEFORME, StatutMouvementFonds.VALIDE],
    );

    const nonAttribueTotal = Number(nonAttribue?.somme ?? 0);
    const alertes: string[] = [];
    for (const p of poches.filter((poche) => poche.detient < 0)) {
      alertes.push(
        `${p.membre.nom} détient ${montantLisible(p.detient)} : il a déclaré avoir ` +
          'remis plus que ce qu’il a reçu. Une réception manque probablement.',
      );
    }
    if (nonAttribueTotal > 0) {
      alertes.push(
        `${montantLisible(nonAttribueTotal)} ont été retirés de Fapshi sans que ` +
          'l’on sache entre les mains de qui ils sont.',
      );
    }
    if (etat.obsolete) {
      alertes.push(
        'Fapshi n’a pas répondu : le solde affiché est celui de la dernière lecture.',
      );
    }

    return {
      soldeFapshi: etat.soldeFapshi,
      obsolete: etat.obsolete,
      totalPoches,
      totalFonds: etat.soldeFapshi + totalPoches,
      nonAttribue: nonAttribueTotal,
      retraitsNonAttribues: Number(nonAttribue?.nombre ?? 0),
      fraisDepots: Number(frais?.somme ?? 0),
      poches,
      alertes,
    };
  }

  async lister(
    pagination: PaginationDto,
  ): Promise<ResultatPagine<MouvementFonds>> {
    return paginer(
      await this.mouvements.findAndCount({
        relations: { membre: true, contrepartie: true, declarePar: true },
        order: { createdAt: 'DESC' },
        skip: pagination.sauter,
        take: pagination.limite,
      }),
      pagination,
    );
  }

  // ──────────────────────────────  Écriture  ────────────────────────────

  /**
   * Enregistre un mouvement.
   *
   * @param auteur celui qui saisit. `dto.membreId` désigne le membre dont la
   *   poche bouge, quand ce n'est pas lui.
   */
  declarer(
    auteur: Pick<User, 'id'>,
    dto: DeclarerMouvementDto,
  ): Promise<ResultatMouvement> {
    return this.exclusif(() => this.declarerExclusif(auteur, dto));
  }

  /** Rattache un retrait Fapshi au membre qui a reçu l'argent. */
  async attribuerRetrait(
    id: string,
    detenteurId: string | null,
  ): Promise<Retrait> {
    const retrait = await this.retraits.findOneBy({ id });
    if (!retrait) {
      throw new NotFoundException('Retrait introuvable.');
    }

    let detenteur: User | null = null;
    if (detenteurId) {
      detenteur = await this.users.findOneBy({ id: detenteurId });
      if (!detenteur) {
        throw new NotFoundException('Ce membre n’existe pas.');
      }
    }

    retrait.detenteur = detenteur;
    return this.retraits.save(retrait);
  }

  /**
   * Abandonne un dépôt resté en attente : il libère l'argent réservé.
   *
   * Si le paiement avait malgré tout abouti, sa notification le validera :
   * comme pour une cotisation, c'est le passage de « échoué » à « abouti »
   * qui déclenche l'effet.
   */
  async abandonnerDepot(id: string): Promise<MouvementFonds> {
    const mouvement = await this.mouvements.findOne({
      where: { id },
      relations: { membre: true },
    });
    if (!mouvement) {
      throw new NotFoundException('Ce mouvement n’existe pas.');
    }
    if (
      mouvement.type !== TypeMouvementFonds.DEPOT_PLATEFORME ||
      mouvement.statut !== StatutMouvementFonds.EN_ATTENTE
    ) {
      throw new ConflictException('Ce dépôt n’est pas en attente.');
    }

    if (mouvement.reference) {
      await this.transactionService.abandonner(mouvement.reference);
    }
    mouvement.statut = StatutMouvementFonds.ECHOUE;
    mouvement.urlPaiement = null;
    return this.mouvements.save(mouvement);
  }

  /**
   * Applique l'issue d'un dépôt, d'où qu'elle vienne (notification Fapshi ou
   * rapprochement). Appelée par l'aiguillage des paiements.
   */
  async traiterIssue(
    transaction: Transaction,
    statut: StatutPaiement,
  ): Promise<void> {
    const mouvement = await this.mouvements.findOne({
      where: { reference: transaction.reference },
      relations: { membre: true },
    });
    if (!mouvement) {
      this.logger.warn(`Dépôt inconnu pour ${transaction.reference}.`);
      return;
    }

    if (statut === StatutPaiement.COMPLETE) {
      await this.mouvements.update(mouvement.id, {
        statut: StatutMouvementFonds.VALIDE,
        urlPaiement: null,
      });
      await this.notificationService.notifier({
        destinataire: mouvement.membre,
        type: TypeNotification.PAIEMENT,
        titre: 'Dépôt reçu sur la plateforme',
        message:
          `Votre dépôt de ${montantLisible(mouvement.montant)} est arrivé sur le ` +
          'compte de la plateforme. Il sort de votre poche.',
        lien: '/admin/finances',
        libelleLien: 'Voir le suivi des fonds',
      });
      await this.alerteTresorerie.remiseSurPlateforme(
        mouvement.membre,
        mouvement.montant,
      );
      return;
    }

    if (statut === StatutPaiement.ECHOUE) {
      await this.mouvements.update(mouvement.id, {
        statut: StatutMouvementFonds.ECHOUE,
        urlPaiement: null,
      });
      await this.notificationService.notifier({
        destinataire: mouvement.membre,
        type: TypeNotification.PAIEMENT,
        titre: 'Dépôt non abouti',
        message:
          `Votre dépôt de ${montantLisible(mouvement.montant)} n’a pas abouti. ` +
          'Rien n’est sorti de votre poche : vous pouvez réessayer.',
        lien: '/admin/finances',
        libelleLien: 'Voir le suivi des fonds',
      });
    }
  }

  /** Efface les pièces jointes de plus de deux mois ; la ligne reste. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgerPieces(): Promise<number> {
    try {
      const limite = new Date(Date.now() - RETENTION_PIECES_MS);
      const perimes = (
        await this.mouvements.find({ where: { createdAt: LessThan(limite) } })
      ).filter((m) => m.piece);

      if (perimes.length === 0) {
        return 0;
      }
      await this.nettoyage.retirer(...perimes.map((m) => m.piece));
      await this.mouvements.update(
        { id: In(perimes.map((m) => m.id)) },
        { piece: null },
      );
      return perimes.length;
    } catch (erreur) {
      this.logger.error(
        `Purge des pièces de remise impossible : ${(erreur as Error).message}`,
      );
      return 0;
    }
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private exclusif<T>(travail: () => Promise<T>): Promise<T> {
    const suite = this.file.then(travail, travail);
    this.file = suite.catch(() => undefined);
    return suite;
  }

  private async declarerExclusif(
    auteur: Pick<User, 'id'>,
    dto: DeclarerMouvementDto,
  ): Promise<ResultatMouvement> {
    const membreId = dto.membreId ?? auteur.id;
    const membre = await this.users.findOneBy({ id: membreId });
    if (!membre) {
      throw new NotFoundException('Ce membre n’existe pas.');
    }

    const contrepartie = await this.contrepartie(dto, membreId);
    const tiers = dto.libelleTiers?.trim() || null;

    if (
      (dto.type === TypeMouvementFonds.REMBOURSEMENT ||
        dto.type === TypeMouvementFonds.DEPENSE) &&
      !tiers
    ) {
      throw new BadRequestException(
        'Dites à qui l’argent est rendu, ou chez qui il est dépensé.',
      );
    }

    if (SORTIES.has(dto.type)) {
      await this.verifierQuIlDetient(membre, dto);
    }

    const commun: DonneesCommunes = {
      type: dto.type,
      membre,
      declarePar: membreId === auteur.id ? null : ({ id: auteur.id } as User),
      contrepartie,
      montant: dto.montant,
      note: dto.note?.trim() || null,
      piece: dto.piece ?? null,
    };

    if (dto.type === TypeMouvementFonds.DEPOT_PLATEFORME) {
      return this.deposer(commun, dto);
    }

    const reception = dto.type === TypeMouvementFonds.RECEPTION;
    const mouvement = await this.mouvements.save(
      this.mouvements.create({
        ...commun,
        beneficiaire: reception ? null : tiers,
        origine: reception ? tiers : null,
        statut: StatutMouvementFonds.VALIDE,
      }),
    );

    if (contrepartie) {
      await this.notificationService.notifier({
        destinataire: contrepartie,
        type: TypeNotification.PAIEMENT,
        titre: 'Remise reçue',
        message:
          `${membre.firstName} ${membre.lastName} vous a remis ` +
          `${montantLisible(dto.montant)}. C’est maintenant dans votre poche : ` +
          'vérifiez que le montant est juste.',
        lien: '/admin/finances',
        libelleLien: 'Voir le suivi des fonds',
      });
    }

    return {
      mouvement: mouvement as unknown as Record<string, unknown>,
      urlPaiement: null,
    };
  }

  private async contrepartie(
    dto: DeclarerMouvementDto,
    membreId: string,
  ): Promise<User | null> {
    if (dto.type !== TypeMouvementFonds.TRANSFERT) {
      return null;
    }
    if (!dto.contrepartieId) {
      throw new BadRequestException('Dites à qui vous passez l’argent.');
    }
    if (dto.contrepartieId === membreId) {
      throw new BadRequestException('On ne se passe pas d’argent à soi-même.');
    }
    const contrepartie = await this.users.findOneBy({ id: dto.contrepartieId });
    if (!contrepartie) {
      throw new NotFoundException('Le membre destinataire n’existe pas.');
    }
    return contrepartie;
  }

  private async verifierQuIlDetient(
    membre: User,
    dto: DeclarerMouvementDto,
  ): Promise<void> {
    const poche = (await this.poches()).find((p) => p.membre.id === membre.id);
    const possible = disponible(poche);

    if (dto.montant > possible) {
      throw new ConflictException(
        `${membre.firstName} ${membre.lastName} ne détient que ` +
          `${montantLisible(Math.max(possible, 0))} : impossible d’enregistrer ` +
          `${LIBELLES[dto.type]} de ${montantLisible(dto.montant)}. ` +
          'Si l’argent a bien été reçu, déclarez d’abord la réception.',
      );
    }
  }

  /**
   * Dépôt de la poche d'un membre sur le compte de la plateforme.
   *
   * Passe par Fapshi comme n'importe quel paiement : c'est ce qui en fait le
   * seul mouvement **attesté**. Le dépôt reste « en attente » — et l'argent
   * réservé — jusqu'à la confirmation de Fapshi.
   */
  private async deposer(
    commun: DonneesCommunes,
    dto: DeclarerMouvementDto,
  ): Promise<ResultatMouvement> {
    const reference = `REM-${randomBytes(6).toString('hex').toUpperCase()}`;
    const frais = Math.ceil(dto.montant * this.tauxFrais.fapshi);

    const mouvement = await this.mouvements.save(
      this.mouvements.create({
        ...commun,
        piece: null,
        beneficiaire: null,
        origine: null,
        reference,
        fraisPrestataire: frais,
        statut: StatutMouvementFonds.EN_ATTENTE,
      }),
    );

    // Ouverte avant l'appel : un webhook qui arrive pendant l'attente trouve
    // une ligne à mettre à jour.
    await this.transactionService.ouvrir({
      reference,
      montant: dto.montant,
      origine: OrigineTransaction.REMISE,
      user: commun.membre,
      methodePaiement: dto.methodePaiement ?? null,
      fraisPrestataire: frais,
    });

    try {
      const resultat = await this.paiement.initier({
        reference,
        montant: dto.montant,
        methode: dto.methodePaiement ?? null,
        telephone: dto.telephone ?? null,
        description: `Remise de ${commun.membre.firstName} ${commun.membre.lastName} — dépôt sur la plateforme`,
      });

      if (resultat.referenceExterne) {
        await this.transactionService.enregistrerReferenceExterne(
          reference,
          resultat.referenceExterne,
        );
      }
      if (resultat.statut === StatutPaiement.ECHOUE) {
        throw new BadRequestException(
          'Le paiement a été refusé par l’opérateur. Rien n’est sorti de votre poche.',
        );
      }

      if (resultat.urlRedirection) {
        await this.mouvements.update(mouvement.id, {
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
      await this.transactionService.abandonner(reference);
      await this.mouvements.update(mouvement.id, {
        statut: StatutMouvementFonds.ECHOUE,
        urlPaiement: null,
      });
      throw erreur;
    }

    const apres = await this.mouvements.findOneOrFail({
      where: { id: mouvement.id },
      relations: { membre: true },
    });
    return {
      mouvement: apres as unknown as Record<string, unknown>,
      urlPaiement: apres.urlPaiement,
    };
  }

  private async poches(): Promise<PocheMembre[]> {
    const manager = this.mouvements.manager;
    const [mouvements, preuves, retraits] = await Promise.all([
      this.mouvements.find({
        relations: { membre: true, contrepartie: true },
      }),
      manager.query<SommeParMembre[]>(
        `SELECT recu_par_id AS "membreId", COALESCE(SUM(montant_recu), 0)::int AS montant
         FROM justificatifs_paiement
         WHERE statut = 'VALIDE' AND recu_par_id IS NOT NULL
         GROUP BY recu_par_id`,
      ),
      manager.query<SommeParMembre[]>(
        `SELECT detenteur_id AS "membreId", COALESCE(SUM(montant), 0)::int AS montant
         FROM retraits
         WHERE statut = $1 AND detenteur_id IS NOT NULL
         GROUP BY detenteur_id`,
        [StatutRetrait.REUSSI],
      ),
    ]);

    const ids = new Set<string>([
      ...mouvements.flatMap((m) =>
        [m.membre.id, m.contrepartie?.id].filter((id): id is string => !!id),
      ),
      ...preuves.map((p) => p.membreId),
      ...retraits.map((r) => r.membreId),
    ]);
    const connus = ids.size
      ? await this.users.find({ where: { id: In([...ids]) } })
      : [];
    const noms = new Map(
      connus.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );

    return calculerPoches({
      mouvements: mouvements.map((m) => ({
        type: m.type,
        statut: m.statut,
        montant: m.montant,
        membreId: m.membre.id,
        contrepartieId: m.contrepartie?.id ?? null,
      })),
      preuves,
      retraits,
      noms,
    });
  }
}
