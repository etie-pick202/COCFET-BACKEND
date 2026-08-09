import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import {
  ControleAcces,
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
import {
  CodeBillet,
  FiltreInscriptionDto,
  SInscrireDto,
} from './dto/billetterie.dto';
import { Inscription, StatutInscription } from './entities/inscription.entity';
import {
  emettreJetonBillet,
  estJetonTournant,
  lireJetonBillet,
  secondesAvantRotation,
} from './jeton-billet';
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

  /**
   * Clé de signature des codes tournants.
   *
   * Dérivée de la clé d'accès à défaut d'une clé dédiée : réutiliser
   * `JWT_ACCESS_SECRET` tel quel ferait signer deux choses différentes par la
   * même valeur, et un jeton de billet deviendrait matière à attaquer les
   * jetons de session. Le passage par HMAC avec une étiquette distincte donne
   * une clé indépendante, sans variable de plus à poser au déploiement.
   */
  private readonly secretQr: string;

  constructor(
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    private readonly evenementService: EvenementService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    private readonly transactionService: TransactionService,
    config: ConfigService,
  ) {
    // `||` et non `??` : une variable posée mais vide doit retomber sur la
    // dérivation, sinon les billets seraient signés avec une clé vide.
    this.secretQr =
      config.get<string>('QR_SECRET') ||
      createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
        .update('billet-qr-tournant')
        .digest('hex');
  }

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
  async scanner(presente: string): Promise<Inscription> {
    const tournant = estJetonTournant(presente);
    const codeBillet = tournant
      ? lireJetonBillet(presente, this.secretQr)
      : presente;

    if (!codeBillet) {
      // Jeton mal formé, périmé ou mal signé : le même refus dans les trois
      // cas. Distinguer aiderait à en fabriquer un.
      throw new BadRequestException(
        'Ce code n’est plus valide : faites-le régénérer dans l’application.',
      );
    }

    const inscription = await this.inscriptions.findOne({
      where: { codeBillet },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException('Billet inconnu.');
    }
    const controle = inscription.evenement.controleAcces;

    if (controle === ControleAcces.AUCUN) {
      // Accepter un scan ici laisserait croire à un contrôle que l'événement
      // n'a pas : le refus dit franchement qu'il n'y a rien à vérifier.
      throw new BadRequestException(
        'Cet événement ne filtre pas l’entrée : il n’y a pas de billet à valider.',
      );
    }
    if (controle === ControleAcces.QR_TOURNANT && !tournant) {
      // Sans ce refus, l'option ne servirait à rien : le code fixe figure en
      // clair dans le jeton tournant, et le lire suffirait à entrer avec une
      // capture d'écran — exactement ce que l'option est censée empêcher.
      throw new BadRequestException(
        'Cet événement exige le code tournant affiché dans l’application.',
      );
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
   * Referme une inscription dont le paiement n'aboutira pas, et rend la place.
   *
   * Ce chemin manquait : le webhook ne traitait que les paiements réussis, et
   * un refus laissait l'inscription en attente indéfiniment — la place
   * occupée par un billet que personne ne paiera, sur un événement qui
   * afficherait complet sans l'être.
   *
   * Conditionnée au statut courant dans la requête elle-même : une
   * notification rejouée, ou la réconciliation croisant un webhook, n'affecte
   * aucune ligne et ne libère donc pas deux fois la même place.
   */
  async echouerPaiement(reference: string, motif: string): Promise<void> {
    const inscription = await this.inscriptions.findOne({
      where: { codeBillet: reference },
      relations: { user: true, evenement: true },
    });

    if (!inscription) {
      this.logger.warn(
        `Échec de paiement pour un billet inconnu : ${reference}`,
      );
      return;
    }

    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({
        statut: StatutInscription.ANNULEE,
        statutPaiement: StatutPaiement.ECHOUE,
      })
      .where('id = :id AND statut = :attendu', {
        id: inscription.id,
        attendu: StatutInscription.EN_ATTENTE,
      })
      .execute();

    if (resultat.affected !== 1) {
      return;
    }

    await this.evenementService.libererUnePlace(inscription.evenement.id);

    await this.notificationService.notifier({
      destinataire: inscription.user,
      type: TypeNotification.PAIEMENT,
      titre: 'Paiement non abouti',
      message:
        `Votre inscription à « ${inscription.evenement.titre} » a été annulée : ` +
        `${motif} La place est de nouveau disponible, vous pouvez réessayer.`,
      lien: `/evenements/${inscription.evenement.id}`,
    });

    this.logger.log(
      `Inscription ${inscription.codeBillet} annulée faute de paiement : place rendue.`,
    );
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
    if (inscription.evenement.controleAcces === ControleAcces.AUCUN) {
      throw new ConflictException(
        'Cet événement ne filtre pas l’entrée : aucun billet n’a été émis.',
      );
    }

    await this.emettreBillet(inscription);
  }

  /**
   * Code d'entrée à présenter, sous la forme qu'exige l'événement.
   *
   * Toujours servi par l'API et jamais figé côté client : sur un événement à
   * code tournant, c'est ce qui garantit que l'image affichée n'a que trente
   * secondes de validité.
   */
  async qrDuBillet(id: string, userId: string): Promise<CodeBillet> {
    const inscription = await this.inscriptions.findOne({
      where: { id, user: { id: userId } },
      relations: { evenement: true },
    });

    if (!inscription) {
      throw new NotFoundException("Ce billet n'existe pas.");
    }
    if (inscription.statut === StatutInscription.ANNULEE) {
      throw new ConflictException('Ce billet a été annulé.');
    }
    if (inscription.statut === StatutInscription.EN_ATTENTE) {
      throw new ConflictException("Ce billet n'est pas encore payé.");
    }

    const controle = inscription.evenement.controleAcces;

    if (controle === ControleAcces.AUCUN) {
      throw new ConflictException(
        'Cet événement ne filtre pas l’entrée : aucun code n’est à présenter.',
      );
    }

    if (controle === ControleAcces.QR_FIXE) {
      return {
        qrCode:
          inscription.qrCode ??
          enUrlDeDonnees(await genererQrBillet(inscription.codeBillet)),
        tournant: false,
        expireDans: null,
      };
    }

    const jeton = emettreJetonBillet(inscription.codeBillet, this.secretQr);

    return {
      qrCode: enUrlDeDonnees(await genererQrBillet(jeton)),
      tournant: true,
      expireDans: secondesAvantRotation(),
    };
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

    // Conservée avant toute autre chose : sans cet identifiant, la
    // réconciliation ne pourra jamais interroger le prestataire sur ce
    // paiement, et un webhook perdu bloquerait la place indéfiniment.
    if (resultat.referenceExterne) {
      await this.transactionService.enregistrerReferenceExterne(
        inscription.codeBillet,
        resultat.referenceExterne,
      );
    }

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
    const controle = inscription.evenement.controleAcces;

    try {
      // Seul le régime fixe grave un QR : sous `QR_TOURNANT` l'image ne vaut
      // que trente secondes et se redemande, sous `AUCUN` il n'y a rien à
      // contrôler. Dans les deux cas, stocker une image donnerait à croire
      // qu'elle ouvre une porte.
      const png =
        controle === ControleAcces.QR_FIXE
          ? await genererQrBillet(inscription.codeBillet)
          : null;

      if (png) {
        await this.inscriptions.update(inscription.id, {
          qrCode: enUrlDeDonnees(png),
        });
      }

      await this.mailService.envoyerBillet(
        inscription.user.email,
        inscription.user.firstName,
        {
          titre: inscription.evenement.titre,
          dateDebut: inscription.evenement.dateDebut,
          lieu: inscription.evenement.lieu,
          codeBillet: inscription.codeBillet,
          qrPng: png,
          // Le gabarit dit alors quoi faire à l'entrée : présenter l'image,
          // ouvrir l'application, ou simplement venir.
          modeAcces: controle,
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
