import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
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
  ) {}

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
    const transaction = await this.transactionService.trouver(dto.reference);

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
        reference: dto.reference,
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
        reference: dto.reference,
        origine: transaction.origine,
        cle: dto.cle,
        montantDeclare: dto.montantDeclare,
        statut: StatutJustificatif.EN_ATTENTE,
        user: { id: user.id } as User,
      }),
    );

    this.logger.log(
      `Preuve de paiement déposée pour ${dto.reference} ` +
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
    await this.enAttenteOuEchouer(id);

    await this.justificatifs.update(id, {
      statut: StatutJustificatif.REFUSE,
      validateur: { id: validateur.id },
      decideLe: new Date(),
      motifRefus: motif,
    });

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
