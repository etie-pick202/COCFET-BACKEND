import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import {
  Evenement,
  StatutEvenement,
  TypeEvenement,
} from '../evenement/entities/evenement.entity';
import { EvenementService } from '../evenement/evenement.service';
import { MailService } from '../mail/mail.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { TransactionService } from '../paiement/transaction.service';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { PASSERELLE_PAIEMENT } from '../paiement/ports/passerelle-paiement';
import { User } from '../user/entities/user.entity';
import { SInscrireDto, FiltreInscriptionDto } from './dto/billetterie.dto';
import { Inscription, StatutInscription } from './entities/inscription.entity';
import { enUrlDeDonnees, genererQrBillet } from './qr-billet';

const TRIS_AUTORISES = ['createdAt', 'statut'] as const;

/** Statuts qui occupent une place. Une annulation la rend. */
const STATUTS_ACTIFS = new Set([
  StatutInscription.EN_ATTENTE,
  StatutInscription.CONFIRMEE,
  StatutInscription.UTILISEE,
]);

@Injectable()
export class BilletterieService {
  private readonly logger = new Logger(BilletterieService.name);

  constructor(
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    private readonly evenementService: EvenementService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    private readonly transactionService: TransactionService,
  ) {}

  /**
   * Inscrit une personne à un événement.
   *
   * L'ordre des opérations est ce qui compte ici. La place est réservée
   * **avant** le paiement, par une mise à jour conditionnelle atomique : sinon
   * deux personnes pourraient payer la même dernière place, et il faudrait
   * rembourser. Si le paiement échoue ensuite, la place est rendue.
   */
  async sInscrire(
    evenementId: string,
    user: User,
    dto: SInscrireDto,
  ): Promise<Inscription> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: user.role,
    });

    this.verifierOuvert(evenement);
    await this.verifierPasDejaInscrit(evenementId, user.id);

    const { prixApplicable } = await this.evenementService.detailPour(
      evenement,
      user,
    );
    const payant = prixApplicable > 0;

    if (payant && (!dto.methodePaiement || !dto.telephone)) {
      throw new BadRequestException(
        'Cet événement est payant : méthode de paiement et numéro sont requis.',
      );
    }

    if (!(await this.evenementService.reserverUnePlace(evenementId))) {
      throw new ConflictException('Cet événement est complet.');
    }

    // Declaree hors du try : la reprise sur erreur doit pouvoir la supprimer,
    // et une variable interne au bloc n'y serait pas visible.
    let inscription: Inscription | null = null;

    try {
      inscription = await this.inscriptions.save(
        this.inscriptions.create({
          user,
          evenement,
          codeBillet: this.genererCodeBillet(),
          prix: prixApplicable,
          methodePaiement: dto.methodePaiement ?? null,
          statut: payant
            ? StatutInscription.EN_ATTENTE
            : StatutInscription.CONFIRMEE,
          statutPaiement: payant
            ? StatutPaiement.EN_ATTENTE
            : StatutPaiement.COMPLETE,
        }),
      );

      if (payant) {
        await this.lancerPaiement(inscription, evenement, dto);
      }

      await this.notifierInscription(user, evenement, inscription);

      // Un événement gratuit, ou un paiement abouti dès l'appel, confirme
      // l'inscription sans qu'aucun webhook ne passe : le billet doit être
      // émis ici, sans quoi ces deux cas n'en recevraient jamais.
      if (inscription.statut === StatutInscription.CONFIRMEE) {
        await this.emettreBillet({ ...inscription, user, evenement });
      }

      return this.trouverBillet(inscription.id, user.id);
    } catch (erreur) {
      // Tout est defait, dans l'ordre inverse. Ne rendre que la place
      // laisserait une inscription orpheline : un billet visible dans « mes
      // billets », jamais paye, et dont le code passerait le controle a
      // l'entree une fois le statut confondu.
      if (inscription) {
        await this.inscriptions.delete(inscription.id);
      }
      await this.evenementService.libererUnePlace(evenementId);
      throw erreur;
    }
  }

  /**
   * Annule une inscription et rend la place.
   *
   * Un billet déjà scanné n'est pas annulable : la personne est entrée, et
   * rendre la place fausserait le comptage à l'entrée.
   */
  async annuler(inscriptionId: string, userId: string): Promise<void> {
    const inscription = await this.trouverBillet(inscriptionId, userId);

    if (inscription.statut === StatutInscription.ANNULEE) {
      return;
    }
    if (inscription.statut === StatutInscription.UTILISEE) {
      throw new ConflictException(
        'Ce billet a déjà été utilisé : il ne peut plus être annulé.',
      );
    }
    if (inscription.evenement.dateDebut.getTime() <= Date.now()) {
      throw new ConflictException(
        'Cet événement a commencé : l’annulation n’est plus possible.',
      );
    }

    await this.inscriptions.update(inscriptionId, {
      statut: StatutInscription.ANNULEE,
    });
    await this.evenementService.libererUnePlace(inscription.evenement.id);

    if (inscription.prix > 0) {
      // Aucun remboursement automatique : il passe par le prestataire et
      // relève d'une décision du bureau. Le signaler évite de laisser croire
      // que l'argent revient tout seul.
      this.logger.warn(
        `Inscription payée annulée (${inscriptionId}, ${inscription.prix} FCFA) : remboursement à traiter manuellement.`,
      );
    }
  }

  async mesBillets(
    userId: string,
    filtre: FiltreInscriptionDto,
  ): Promise<ResultatPagine<Inscription>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    const requete = this.inscriptions
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.evenement', 'e')
      .where('i.user_id = :userId', { userId });

    if (filtre.statut) {
      requete.andWhere('i.statut = :statut', { statut: filtre.statut });
    }
    if (filtre.aVenir) {
      requete.andWhere('e.date_debut > :maintenant', {
        maintenant: new Date(),
      });
    }

    requete
      .orderBy(`i.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  /** Inscriptions d'un événement. Réservé au bureau. */
  async listerPourEvenement(
    evenementId: string,
    filtre: FiltreInscriptionDto,
  ): Promise<ResultatPagine<Inscription>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    return paginer(
      await this.inscriptions.findAndCount({
        where: {
          evenement: { id: evenementId },
          ...(filtre.statut ? { statut: filtre.statut } : {}),
        },
        relations: { user: true },
        order: { [tri]: filtre.ordre },
        skip: filtre.sauter,
        take: filtre.limite,
      }),
      filtre,
    );
  }

  /**
   * Valide un billet à l'entrée.
   *
   * Le passage à UTILISEE est conditionné au statut courant dans la requête
   * elle-même : deux scans simultanés du même code ne peuvent pas réussir tous
   * les deux, et le second reçoit un refus explicite.
   */
  async scanner(codeBillet: string): Promise<Inscription> {
    const inscription = await this.inscriptions.findOne({
      where: { codeBillet },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException('Billet inconnu.');
    }
    if (inscription.statut === StatutInscription.ANNULEE) {
      throw new ConflictException('Ce billet a été annulé.');
    }
    if (inscription.statut === StatutInscription.EN_ATTENTE) {
      throw new ConflictException("Ce billet n'est pas payé.");
    }

    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({ statut: StatutInscription.UTILISEE, scannedAt: new Date() })
      .where('id = :id AND statut = :attendu', {
        id: inscription.id,
        attendu: StatutInscription.CONFIRMEE,
      })
      .execute();

    if (resultat.affected !== 1) {
      throw new ConflictException(
        `Ce billet a déjà été scanné${
          inscription.scannedAt
            ? ` le ${inscription.scannedAt.toLocaleString('fr-FR')}`
            : ''
        }.`,
      );
    }

    return this.inscriptions.findOneOrFail({
      where: { id: inscription.id },
      relations: { user: true, evenement: true },
    });
  }

  /** Confirme une inscription dont le paiement a abouti. */
  async confirmerPaiement(reference: string): Promise<void> {
    const inscription = await this.inscriptions.findOne({
      where: { codeBillet: reference },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      this.logger.warn(`Paiement reçu pour un billet inconnu : ${reference}`);
      return;
    }

    // Conditionnee au statut courant : un second webhook pour la meme
    // reference n'affecte aucune ligne, et la notification ne part qu'une fois.
    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({
        statut: StatutInscription.CONFIRMEE,
        statutPaiement: StatutPaiement.COMPLETE,
      })
      .where('id = :id AND statut_paiement != :complete', {
        id: inscription.id,
        complete: StatutPaiement.COMPLETE,
      })
      .execute();

    if (resultat.affected !== 1) {
      return;
    }

    await this.notificationService.notifier({
      destinataire: inscription.user,
      type: TypeNotification.PAIEMENT,
      titre: 'Paiement confirmé',
      message: `Votre billet pour « ${inscription.evenement.titre} » est confirmé. Code : ${inscription.codeBillet}.`,
      lien: `/billets/${inscription.id}`,
    });

    // Après la mise à jour conditionnelle : un webhook rejoué n'affecte aucune
    // ligne, sort plus haut, et ne renvoie donc pas un second billet.
    await this.emettreBillet(inscription);
  }

  /**
   * Renvoie le billet à la demande.
   *
   * Un email se perd, atterrit en indésirable, ou part vers une adresse que la
   * personne ne relève plus. Sans ce recours, le seul moyen de récupérer son
   * billet serait d'annuler puis de se réinscrire — donc de repayer.
   */
  async renvoyerBillet(inscriptionId: string, userId: string): Promise<void> {
    const inscription = await this.inscriptions.findOne({
      where: { id: inscriptionId, user: { id: userId } },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException("Ce billet n'existe pas.");
    }
    if (inscription.statut === StatutInscription.ANNULEE) {
      throw new ConflictException('Ce billet a été annulé.');
    }
    if (inscription.statut === StatutInscription.EN_ATTENTE) {
      throw new ConflictException(
        "Ce billet n'est pas encore payé : il n'y a rien à envoyer.",
      );
    }

    await this.emettreBillet(inscription);
  }

  async trouverBillet(id: string, userId: string): Promise<Inscription> {
    // Le propriétaire fait partie de la condition de recherche : sans cela,
    // connaître un identifiant suffirait à lire le billet de quelqu'un
    // d'autre, avec son code d'entrée.
    const inscription = await this.inscriptions.findOne({
      where: { id, user: { id: userId } },
      relations: { evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException("Ce billet n'existe pas.");
    }

    return inscription;
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private verifierOuvert(evenement: Evenement): void {
    if (evenement.statut !== StatutEvenement.PUBLIE) {
      throw new BadRequestException(
        'Les inscriptions ne sont pas ouvertes pour cet événement.',
      );
    }
    if (evenement.dateDebut.getTime() <= Date.now()) {
      throw new BadRequestException('Cet événement a déjà commencé.');
    }
    if (evenement.type === TypeEvenement.SUR_INVITATION) {
      // Le bureau inscrit lui-même les invités : laisser l'inscription libre
      // viderait la notion d'invitation de son sens.
      throw new BadRequestException(
        'Cet événement est sur invitation : rapprochez-vous du bureau.',
      );
    }
  }

  private async verifierPasDejaInscrit(
    evenementId: string,
    userId: string,
  ): Promise<void> {
    const existante = await this.inscriptions.findOne({
      where: {
        evenement: { id: evenementId },
        user: { id: userId },
      },
      order: { createdAt: 'DESC' },
    });

    // Une inscription annulée ne bloque pas : on doit pouvoir se réinscrire
    // après s'être désisté.
    if (existante && STATUTS_ACTIFS.has(existante.statut)) {
      throw new ConflictException('Vous êtes déjà inscrit à cet événement.');
    }
  }

  /**
   * Code d'entrée du billet.
   *
   * Aléatoire cryptographique, et non un compteur ou un horodatage : le code
   * vaut droit d'entrée, et une suite prévisible se devine.
   */
  private genererCodeBillet(): string {
    return `COCFET-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private async lancerPaiement(
    inscription: Inscription,
    evenement: Evenement,
    dto: SInscrireDto,
  ): Promise<void> {
    // Ouverte **avant** l'appel au prestataire : si le webhook arrive pendant
    // que nous attendons encore la réponse, il trouve une ligne à mettre à
    // jour plutôt que rien, et le paiement n'est pas perdu.
    await this.transactionService.ouvrir({
      reference: inscription.codeBillet,
      montant: inscription.prix,
      origine: OrigineTransaction.EVENEMENT,
      user: inscription.user,
      methodePaiement: dto.methodePaiement ?? null,
    });

    const resultat = await this.paiement.initier({
      // Le code du billet sert de référence : il est unique, et c'est lui qui
      // permet de retrouver l'inscription au retour du webhook.
      reference: inscription.codeBillet,
      montant: inscription.prix,
      methode: dto.methodePaiement!,
      telephone: dto.telephone!,
      description: `Billet — ${evenement.titre}`,
    });

    if (resultat.statut === StatutPaiement.ECHOUE) {
      throw new BadRequestException(
        'Le paiement a été refusé. Aucune place ne vous a été réservée.',
      );
    }

    if (resultat.statut === StatutPaiement.COMPLETE) {
      await this.inscriptions.update(inscription.id, {
        statut: StatutInscription.CONFIRMEE,
        statutPaiement: StatutPaiement.COMPLETE,
      });

      // Reporté sur l'objet en mémoire : l'appelant décide d'émettre le billet
      // à partir de lui, et le laisser périmé priverait de billet quiconque
      // paie sans passer par le webhook.
      inscription.statut = StatutInscription.CONFIRMEE;
      inscription.statutPaiement = StatutPaiement.COMPLETE;
    }
  }

  /**
   * Émet le billet : QR code enregistré, puis envoi par email.
   *
   * **Ne lève jamais.** Dès la confirmation, la place est payée et le code est
   * en base : le scan à l'entrée le reconnaîtra, email reçu ou non. Laisser
   * une panne SMTP remonter ferait échouer l'inscription — donc rendre la
   * place et supprimer le billet — pour un incident qui n'appartient ni à la
   * personne inscrite, ni à son paiement.
   *
   * Le QR est régénéré à chaque appel : il dérive du seul code du billet, qui
   * ne change pas, et un renvoi produit donc exactement la même image.
   */
  private async emettreBillet(inscription: Inscription): Promise<void> {
    try {
      const png = await genererQrBillet(inscription.codeBillet);

      await this.inscriptions.update(inscription.id, {
        qrCode: enUrlDeDonnees(png),
      });

      await this.mailService.envoyerBillet(
        inscription.user.email,
        inscription.user.firstName,
        {
          titre: inscription.evenement.titre,
          dateDebut: inscription.evenement.dateDebut,
          lieu: inscription.evenement.lieu,
          codeBillet: inscription.codeBillet,
          qrPng: png,
        },
      );
    } catch (erreur) {
      this.logger.error(
        `Émission du billet ${inscription.codeBillet} impossible : l'inscription reste valide.`,
        erreur,
      );
    }
  }

  private async notifierInscription(
    user: User,
    evenement: Evenement,
    inscription: Inscription,
  ): Promise<void> {
    const confirmee = inscription.statut === StatutInscription.CONFIRMEE;

    await this.notificationService.notifier({
      destinataire: user,
      type: TypeNotification.EVENEMENT,
      titre: confirmee
        ? `Inscription confirmée : ${evenement.titre}`
        : `Inscription en attente de paiement : ${evenement.titre}`,
      message: confirmee
        ? `Votre billet est valide. Code d'entrée : ${inscription.codeBillet}.`
        : 'Votre place est réservée le temps du paiement.',
      lien: `/billets/${inscription.id}`,
    });
  }
}
