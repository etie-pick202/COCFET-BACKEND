import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ActiviteService } from '../activite/activite.service';
import { TypeActivite } from '../activite/entities/journal-activite.entity';
import { CotisationService } from '../cotisation/cotisation.service';
import { DocumentService } from '../document/document.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import {
  PASSERELLE_PAIEMENT,
  type PasserellePaiement,
} from '../paiement/ports/passerelle-paiement';
import { RepercussionPaiementService } from '../paiement/repercussion-paiement.service';
import { TransactionService } from '../paiement/transaction.service';
import { User } from '../user/entities/user.entity';
import {
  SoumettreJustificatifDto,
  ValiderJustificatifDto,
} from './dto/justificatif.dto';
import {
  JustificatifPaiement,
  StatutJustificatif,
} from './entities/justificatif-paiement.entity';

/**
 * Au-delà, la capture est effacée du stockage.
 *
 * Deux mois couvrent largement le délai pendant lequel une décision peut être
 * contestée. Conserver ces images indéfiniment reviendrait à garder des
 * relevés bancaires qui ne nous appartiennent pas, pour un usage qui a cessé.
 */
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

@Injectable()
export class JustificatifService {
  private readonly logger = new Logger(JustificatifService.name);

  constructor(
    @InjectRepository(JustificatifPaiement)
    private readonly justificatifs: Repository<JustificatifPaiement>,
    private readonly transactionService: TransactionService,
    private readonly repercussion: RepercussionPaiementService,
    private readonly nettoyage: NettoyageFichiers,
    private readonly cotisationService: CotisationService,
    private readonly alerteTresorerie: AlerteTresorerieService,
    private readonly notificationService: NotificationService,
    private readonly documents: DocumentService,
    private readonly activiteService: ActiviteService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly passerelle: PasserellePaiement,
  ) {}

  /** Une file par preuve : valider, refuser et défaire ne se chevauchent pas. */
  private readonly verrous = new Map<string, Promise<unknown>>();

  private exclusif<T>(id: string, tache: () => Promise<T>): Promise<T> {
    const precedent = this.verrous.get(id) ?? Promise.resolve();
    const suite = precedent.then(tache, tache);
    const marque = suite.catch(() => undefined);
    this.verrous.set(id, marque);
    // Libère l'entrée quand plus personne n'attend : la table ne grossit pas.
    void marque.then(() => {
      if (this.verrous.get(id) === marque) {
        this.verrous.delete(id);
      }
    });
    return suite;
  }

  /**
   * Dépose une preuve de paiement.
   *
   * La transaction doit exister et être **encore en attente** : justifier un
   * règlement déjà abouti n'aurait aucun sens, et justifier ce qui n'existe pas
   * ouvrirait la porte à des pièces sans objet que la trésorerie devrait trier.
   */
  async soumettre(
    user: Pick<User, 'id'>,
    dto: SoumettreJustificatifDto,
  ): Promise<JustificatifPaiement> {
    if (!dto.participationId) {
      return this.deposer(user, dto.reference!, dto, null);
    }

    // Cotisation : le règlement de l'échéance choisie est ouvert ici, et la
    // pièce s'y rattache. S'il ne peut pas être déposé, le règlement est
    // défait — sinon il bloquerait la personne sans qu'aucune pièce ne
    // vienne jamais le trancher.
    const prepare = await this.cotisationService.preparerJustificatif(
      user,
      dto.participationId,
      dto.ordreTranche ?? null,
      dto.montantDeclare,
    );

    try {
      return await this.deposer(user, prepare.reference, dto, prepare.libelle);
    } catch (erreur) {
      await this.cotisationService.annulerPreparation(prepare.reference);
      throw erreur;
    }
  }

  private async deposer(
    user: Pick<User, 'id'>,
    reference: string,
    dto: Pick<SoumettreJustificatifDto, 'cle' | 'montantDeclare'>,
    libelle: string | null,
  ): Promise<JustificatifPaiement> {
    const transaction = await this.transactionService.trouver(reference);

    if (!transaction) {
      throw new NotFoundException('Aucun règlement ne porte cette référence.');
    }
    if (transaction.statut !== StatutPaiement.EN_ATTENTE) {
      throw new ConflictException(
        'Ce règlement est déjà tranché : il n’attend aucune preuve.',
      );
    }
    if (transaction.user?.id !== user.id) {
      // Déposer une preuve pour le règlement d'autrui permettrait de faire
      // confirmer — ou refuser — un paiement qui ne nous regarde pas.
      throw new NotFoundException('Aucun règlement ne porte cette référence.');
    }

    const enAttente = await this.justificatifs.findOne({
      where: {
        reference,
        statut: StatutJustificatif.EN_ATTENTE,
      },
    });

    if (enAttente) {
      // Sans ce contrôle, on peut noyer la trésorerie sous les captures d'un
      // même règlement, et elle finirait par en valider une sans regarder.
      throw new ConflictException(
        'Une preuve de ce règlement attend déjà une décision.',
      );
    }

    const justificatif = await this.justificatifs.save(
      this.justificatifs.create({
        reference,
        origine: transaction.origine,
        libelle,
        cle: dto.cle,
        montantDeclare: dto.montantDeclare,
        statut: StatutJustificatif.EN_ATTENTE,
        user: { id: user.id } as User,
      }),
    );

    // La trésorerie a une décision à prendre : elle l'apprend sans avoir à
    // ouvrir la liste des preuves pour le découvrir.
    if (transaction.user) {
      await this.alerteTresorerie.preuveADecider(
        transaction.user,
        libelle ?? `le règlement ${reference}`,
        dto.montantDeclare,
      );
    }

    this.logger.log(
      `Preuve de paiement déposée pour ${reference} ` +
        `(${dto.montantDeclare} FCFA déclarés).`,
    );

    return justificatif;
  }

  /**
   * Reconnaît le paiement, et le répercute au domaine.
   *
   * La validation produit **exactement** les mêmes effets qu'une notification
   * du prestataire : la commande passe payée, le billet est émis. C'est le
   * même service qui s'en charge, précisément pour qu'un paiement reconnu à la
   * main ne délivre pas moins qu'un paiement en ligne.
   */
  async valider(
    id: string,
    validateur: Pick<User, 'id'>,
    dto: ValiderJustificatifDto,
  ): Promise<JustificatifPaiement> {
    const justificatif = await this.enAttenteOuEchouer(id);

    await this.justificatifs.update(id, {
      statut: StatutJustificatif.VALIDE,
      validateur: { id: validateur.id },
      decideLe: new Date(),
      montantRecu: dto.montantRecu,
      // A defaut de destinataire designe, le validateur est repute avoir recu
      // l'argent : c'est le cas le plus courant, et laisser le champ vide
      // rendrait l'encaisse incalculable.
      recuPar: { id: dto.recuParId ?? validateur.id },
    });

    // Ce qui a été reçu, sans frais : l'argent n'est pas passé par le
    // prestataire. Avant l'application, pour que le crédit d'une cotisation
    // porte sur ce montant certifié et non sur celui d'abord annoncé.
    await this.transactionService.certifier(
      justificatif.reference,
      dto.montantRecu,
    );

    // La transaction d'abord : c'est elle qui dédoublonne. Sans ce passage,
    // une notification du prestataire arrivant ensuite rejouerait les effets.
    const applique = await this.transactionService.appliquer(
      justificatif.reference,
      StatutPaiement.COMPLETE,
    );

    if (applique) {
      await this.repercussion.repercuter(
        justificatif.reference,
        StatutPaiement.COMPLETE,
      );
    }

    this.logger.log(
      `Preuve ${id} validée : ${justificatif.reference} reconnu payé.`,
    );

    return this.trouver(id);
  }

  /**
   * Défait la validation d'une preuve reconnue par erreur.
   *
   * Tout compte rendu à ceux qui ont accès à la trésorerie, car une validation
   * touche un solde, parfois un billet ou une commande. La preuve **redevient
   * en attente** : on peut ensuite la valider correctement, ou la refuser.
   *
   * Ce que la méthode défait, dans cet ordre — et rien n'est modifié si un
   * domaine refuse :
   * 1. les effets du paiement (crédit d'une cotisation, billet, commande) ;
   * 2. la transaction, remise en attente ;
   * 3. la preuve elle-même, qui garde la trace de l'annulation ;
   * 4. la facture émise, retirée.
   *
   * **Rejouable.** Si le temps 3 échoue après le 1, rappeler la méthode ne
   * défait pas deux fois : chaque domaine teste son état avant d'écrire.
   *
   * Refusée quand l'effet ne se reprend pas : un billet déjà scanné, une
   * commande déjà prête ou retirée. Le message dit alors pourquoi.
   */
  async annulerValidation(
    id: string,
    auteur: Pick<User, 'id'>,
    motif: string,
  ): Promise<JustificatifPaiement> {
    return this.exclusif(id, async () => {
      const justificatif = await this.trouver(id);

      if (justificatif.statut !== StatutJustificatif.VALIDE) {
        throw new BadRequestException(
          'Seule une preuve validée peut voir sa validation annulée.',
        );
      }

      await this.verifierQueFapshiNAttestePas(justificatif.reference);

      const facture = await this.repercussion.annuler(
        justificatif.reference,
        justificatif.montantDeclare,
      );
      await this.transactionService.rouvrir(
        justificatif.reference,
        justificatif.montantDeclare,
      );

      const montantRecu =
        justificatif.montantRecu ?? justificatif.montantDeclare;
      const ancienValidateur = justificatif.validateur;

      await this.justificatifs.update(id, {
        statut: StatutJustificatif.EN_ATTENTE,
        validateur: null,
        decideLe: null,
        montantRecu: null,
        recuPar: null,
        motifRefus: null,
        validationAnnuleePar: { id: auteur.id },
        validationAnnuleeLe: new Date(),
        motifAnnulation: motif,
        annulations: justificatif.annulations + 1,
      });

      const numeroFacture = facture
        ? await this.documents.retirerFacture(facture.type, facture.source)
        : null;

      await this.tracer(
        justificatif,
        auteur.id,
        motif,
        montantRecu,
        ancienValidateur,
        numeroFacture,
      );

      this.logger.warn(
        `Validation de la preuve ${id} annulée (${justificatif.reference}) : ${motif}`,
      );

      return this.trouver(id);
    });
  }

  /**
   * Refuse la preuve, sans toucher au règlement.
   *
   * Le paiement reste en attente : un refus dit que *cette image* ne prouve
   * rien, pas que l'argent n'a pas été versé. La personne peut en déposer une
   * autre, et le motif lui dit quoi corriger.
   */
  async refuser(
    id: string,
    validateur: Pick<User, 'id'>,
    motif: string,
  ): Promise<JustificatifPaiement> {
    const justificatif = await this.enAttenteOuEchouer(id);

    await this.justificatifs.update(id, {
      statut: StatutJustificatif.REFUSE,
      validateur: { id: validateur.id },
      decideLe: new Date(),
      motifRefus: motif,
    });

    // Une cotisation fait exception : son règlement a été ouvert pour cette
    // seule pièce. Le laisser en attente bloquerait toutes les autres
    // échéances de la personne ; il est clos, et elle est prévenue du motif.
    // Une nouvelle pièce ouvrira un nouveau règlement.
    if (
      justificatif.origine === OrigineTransaction.COTISATION &&
      (await this.transactionService.appliquer(
        justificatif.reference,
        StatutPaiement.ECHOUE,
      ))
    ) {
      await this.repercussion.repercuter(
        justificatif.reference,
        StatutPaiement.ECHOUE,
        motif,
      );
    }

    return this.trouver(id);
  }

  /** Historique complet, avec le titulaire de chaque pièce. */
  lister(filtre: {
    statut?: StatutJustificatif;
    origine?: OrigineTransaction;
    reference?: string;
  }): Promise<JustificatifPaiement[]> {
    return this.justificatifs.find({
      where: {
        ...(filtre.statut ? { statut: filtre.statut } : {}),
        ...(filtre.origine ? { origine: filtre.origine } : {}),
        ...(filtre.reference ? { reference: filtre.reference } : {}),
      },
      relations: { user: true, validateur: true, recuPar: true },
      order: { createdAt: 'DESC' },
    });
  }

  lesSiens(userId: string): Promise<JustificatifPaiement[]> {
    return this.justificatifs.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }

  async trouver(id: string): Promise<JustificatifPaiement> {
    const justificatif = await this.justificatifs.findOne({
      where: { id },
      relations: { user: true, validateur: true, recuPar: true },
    });

    if (!justificatif) {
      throw new NotFoundException('Cette preuve de paiement n’existe pas.');
    }

    return justificatif;
  }

  /**
   * Efface les captures de plus de deux mois.
   *
   * **La décision est conservée, l'image non.** Ce qui compte à long terme est
   * qu'un paiement a été reconnu, par qui et quand ; l'image, elle, est un
   * relevé qui ne nous appartient pas et dont l'usage a cessé.
   *
   * La ligne est mise à jour même si l'effacement échoue : la garder pointant
   * vers un objet disparu vaut mieux que la croire encore consultable.
   */
  async purger(): Promise<number> {
    const limite = new Date(Date.now() - RETENTION_MS);

    const perimes = await this.justificatifs.find({
      where: { createdAt: LessThan(limite) },
    });

    const aEffacer = perimes.filter((justificatif) => justificatif.cle);
    if (aEffacer.length === 0) {
      return 0;
    }

    await this.nettoyage.retirer(...aEffacer.map((piece) => piece.cle));
    await this.justificatifs.update(
      aEffacer.map((piece) => piece.id),
      { cle: null },
    );

    this.logger.log(
      `${aEffacer.length} preuve(s) de paiement purgée(s) : la décision reste, l’image non.`,
    );

    return aEffacer.length;
  }

  /**
   * Refuse de défaire un paiement que Fapshi atteste lui-même.
   *
   * Une commande lancée en ligne puis justifiée par une preuve porte une
   * référence Fapshi : si le client a finalement payé en ligne, l'argent est
   * bel et bien arrivé, et annuler la validation ferait disparaître un
   * règlement réel. On le demande donc à Fapshi **avant** de rien défaire — et
   * si Fapshi ne répond pas, on s'abstient : mieux vaut réessayer dans un
   * instant que défaire à l'aveugle.
   */
  private async verifierQueFapshiNAttestePas(reference: string): Promise<void> {
    const transaction = await this.transactionService.trouver(reference);
    if (!transaction?.referenceExterne) {
      return;
    }

    let etat: StatutPaiement;
    try {
      etat = (await this.passerelle.verifier(transaction.referenceExterne))
        .statut;
    } catch {
      throw new ConflictException(
        'Fapshi ne répond pas : impossible de vérifier que ce paiement n’a pas aussi été réglé en ligne. Réessayez dans un instant.',
      );
    }

    if (etat === StatutPaiement.COMPLETE) {
      throw new ConflictException(
        'Ce paiement est aussi confirmé par Fapshi : l’argent est bien arrivé, la validation ne peut pas être annulée.',
      );
    }
  }

  /**
   * Garde la mémoire d'une annulation, et en prévient ceux qu'elle concerne.
   *
   * La ligne de la preuve ne retient que la dernière ; le journal d'activité
   * garde chacune, avec qui, quand, pourquoi, et ce qui a été défait. Le payeur
   * est prévenu : un règlement qu'il croyait reçu ne l'est plus, et il doit le
   * savoir avant de le découvrir sur sa page.
   *
   * Ne lève jamais : l'annulation est faite, ses traces ne doivent pas la
   * faire échouer.
   */
  private async tracer(
    justificatif: JustificatifPaiement,
    auteurId: string,
    motif: string,
    montantRecu: number,
    ancienValidateur: User | null,
    numeroFacture: string | null,
  ): Promise<void> {
    const objet =
      justificatif.libelle ?? `le règlement ${justificatif.reference}`;

    try {
      await this.activiteService.journaliser({
        type: TypeActivite.PAIEMENT,
        message:
          `Validation annulée : preuve de ${justificatif.user.firstName} ` +
          `${justificatif.user.lastName} pour ${objet} (${montantRecu} FCFA). ` +
          `Motif : ${motif}`,
        auteur: { id: auteurId } as User,
        metadata: {
          justificatif: justificatif.id,
          reference: justificatif.reference,
          montantRecu,
          validateurInitial: ancienValidateur?.id ?? null,
          factureRetiree: numeroFacture,
        },
      });

      await this.notificationService.notifier({
        destinataire: justificatif.user,
        type: TypeNotification.PAIEMENT,
        titre: 'Votre preuve de paiement est de nouveau examinée',
        message:
          `La validation de votre preuve pour ${objet} a été annulée : ${motif}. ` +
          'Votre règlement n’est plus compté pour le moment ; la trésorerie ' +
          'va l’examiner de nouveau.' +
          (numeroFacture
            ? ` La facture ${numeroFacture} est retirée ; une nouvelle vous sera délivrée si le règlement est reconnu.`
            : ''),
        lien: '/mon-espace/cotisations',
        libelleLien: 'Voir mes règlements',
      });

      const auteur = await this.users.findOneBy({ id: auteurId });
      await this.alerteTresorerie.validationAnnulee(
        justificatif.user,
        objet,
        montantRecu,
        auteur
          ? `${auteur.firstName} ${auteur.lastName}`.trim()
          : 'La trésorerie',
        motif,
        auteurId,
      );
    } catch (erreur) {
      this.logger.error(
        `Traces de l'annulation de ${justificatif.id} incomplètes : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }

  private async enAttenteOuEchouer(id: string): Promise<JustificatifPaiement> {
    const justificatif = await this.trouver(id);

    if (justificatif.statut !== StatutJustificatif.EN_ATTENTE) {
      throw new BadRequestException(
        'Cette preuve a déjà été tranchée : elle ne se rejuge pas.',
      );
    }

    return justificatif;
  }
}
