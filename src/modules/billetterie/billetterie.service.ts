import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { ActiviteService } from '../activite/activite.service';
import { TypeActivite } from '../activite/entities/journal-activite.entity';
import {
  ControleAcces,
  Evenement,
  StatutEvenement,
  TypeEvenement,
} from '../evenement/entities/evenement.entity';
import { EvenementService } from '../evenement/evenement.service';
import { validerReponses } from '../evenement/options';
import { OptionsEvenementService } from './options-evenement.service';
import { MailService } from '../mail/mail.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { NotificationService } from '../notification/notification.service';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { TransactionService } from '../paiement/transaction.service';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { PASSERELLE_PAIEMENT } from '../paiement/ports/passerelle-paiement';
import type { ProcheTrouve } from '../user/dto/user.dto';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import {
  CodeBillet,
  FiltreInscriptionDto,
  InscrireGroupeDto,
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
import { EtatFenetre, etatFenetre, motifRefus } from './fenetre-scan';
import { AffectationScanner } from './entities/affectation-scanner.entity';
import { Role, estAdministrateur } from '../../common/enums/role.enum';
import {
  calculerFrais,
  tauxFraisDepuisConfig,
  TauxFrais,
} from '../paiement/frais-paiement';
import { AUCUN_FRAIS } from '../paiement/entities/frais-encaissement.embed';

const TRIS_AUTORISES = ['createdAt', 'statut'] as const;

/** Statuts qui occupent une place. Une annulation la rend. */
const STATUTS_ACTIFS = new Set([
  StatutInscription.EN_ATTENTE,
  StatutInscription.CONFIRMEE,
  StatutInscription.UTILISEE,
]);

/** Une personne à inscrire dans un paiement, avec ce qu'elle devra. */
interface Participant {
  user: User;
  reponses: Record<string, string>;
  /** Le tarif **de cette personne** : campus ou externe, selon sa promotion. */
  prix: number;
}

/** Ce que l'on rend à qui vient d'inscrire des proches — jamais leurs codes d'entrée. */
export interface GroupeInscrit {
  /** Référence du paiement : à suivre sur la page de retour. */
  reference: string;
  statutPaiement: StatutPaiement;
  urlPaiement: string | null;
  /** Ce qui est débité au payeur, frais compris. */
  montantDebite: number;
  billets: {
    id: string;
    statut: StatutInscription;
    prix: number;
    beneficiaire: { id: string; prenom: string; nom: string };
    pourMoi: boolean;
  }[];
}

/** Une personne retrouvée, avec ce que son billet coûterait pour cet événement. */
export interface ProcheAvecTarif extends ProcheTrouve {
  /** Le tarif de **cette personne** : campus ou externe selon sa promotion. */
  prix: number;
  tarifCampus: boolean;
}

/** Un billet que l'on a payé pour quelqu'un d'autre. */
export interface BilletOffert {
  id: string;
  statut: StatutInscription;
  statutPaiement: StatutPaiement;
  prix: number;
  createdAt: Date;
  evenement: { id: string; titre: string; dateDebut: Date; lieu: string };
  beneficiaire: { prenom: string; nom: string };
}

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

  /** Taux des frais répercutés sur l'acheteur — voir frais-paiement.ts. */
  private readonly tauxFrais: TauxFrais;

  constructor(
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    @InjectRepository(AffectationScanner)
    private readonly affectations: Repository<AffectationScanner>,
    private readonly evenementService: EvenementService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    private readonly transactionService: TransactionService,
    private readonly activiteService: ActiviteService,
    private readonly userService: UserService,
    private readonly alerteTresorerie: AlerteTresorerieService,
    private readonly options: OptionsEvenementService,
    config: ConfigService,
  ) {
    // `||` et non `??` : une variable posée mais vide doit retomber sur la
    // dérivation, sinon les billets seraient signés avec une clé vide.
    this.secretQr =
      config.get<string>('QR_SECRET') ||
      createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
        .update('billet-qr-tournant')
        .digest('hex');
    this.tauxFrais = tauxFraisDepuisConfig(config);
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

    // Les choix demandés (taille de T-shirt…) sont contrôlés **avant** de
    // réserver la place : une réponse manquante ne doit rien laisser derrière.
    const reponses = validerReponses(
      evenement.options ?? [],
      dto.reponses,
      true,
    );

    const { prixApplicable } = await this.evenementService.detailPour(
      evenement,
      user,
    );
    const payant = prixApplicable > 0;

    if (!(await this.evenementService.reserverUnePlace(evenementId))) {
      throw new ConflictException('Cet événement est complet.');
    }

    // Calcule ici, jamais dans lancerPaiement : le detail doit atterrir sur
    // l'inscription des sa creation, pour que « mes billets » l'affiche meme
    // si le paiement echoue avant d'aboutir.
    const frais = payant
      ? calculerFrais(prixApplicable, dto.methodePaiement, this.tauxFrais)
      : null;

    // Declaree hors du try : la reprise sur erreur doit pouvoir la supprimer,
    // et une variable interne au bloc n'y serait pas visible.
    let inscription: Inscription | null = null;

    try {
      inscription = await this.options.enregistrerAvecStock(
        evenement,
        reponses,
        this.inscriptions.create({
          user,
          evenement,
          reponses,
          codeBillet: this.genererCodeBillet(),
          prix: prixApplicable,
          frais: frais
            ? {
                fraisFapshi: frais.fraisFapshi,
                fraisRetrait: frais.fraisRetrait,
                montantTtc: frais.montantTtc,
              }
            : AUCUN_FRAIS,
          methodePaiement: dto.methodePaiement ?? null,
          statut: payant
            ? StatutInscription.EN_ATTENTE
            : StatutInscription.CONFIRMEE,
          statutPaiement: payant
            ? StatutPaiement.EN_ATTENTE
            : StatutPaiement.COMPLETE,
        }),
      );

      let urlPaiement: string | null = null;
      if (payant) {
        urlPaiement = await this.lancerPaiement(inscription, evenement, dto);
      }

      await this.notifierInscription(user, evenement, inscription);

      // Un événement gratuit, ou un paiement abouti dès l'appel, confirme
      // l'inscription sans qu'aucun webhook ne passe : le billet doit être
      // émis ici, sans quoi ces deux cas n'en recevraient jamais.
      if (inscription.statut === StatutInscription.CONFIRMEE) {
        await this.emettreBillet({ ...inscription, user, evenement });
      }

      if (urlPaiement) {
        // Conservee : qui ferme l'onglet avant de payer doit pouvoir revenir
        // a son inscription plutot que de l'annuler pour la refaire.
        await this.inscriptions.update(inscription.id, { urlPaiement });
      }

      return this.trouverBillet(inscription.id, user.id);
    } catch (erreur) {
      // Tout est defait, dans l'ordre inverse. Ne rendre que la place
      // laisserait une inscription orpheline : un billet visible dans « mes
      // billets », jamais paye, et dont le code passerait le controle a
      // l'entree une fois le statut confondu.
      if (inscription) {
        // Avant la suppression : la référence de la transaction **est** le
        // code du billet. Sans cela, une passerelle qui refuse laisserait une
        // transaction en attente que la réconciliation ne peut ni vérifier ni
        // clore, et qui pèserait au journal de trésorerie.
        await this.transactionService.abandonner(inscription.codeBillet);
        await this.inscriptions.delete(inscription.id);
      }
      await this.evenementService.libererUnePlace(evenementId);
      throw erreur;
    }
  }

  // ─────────────────────  Inscrire des proches, payer à plusieurs  ─────────────────────

  /**
   * Inscrit une ou plusieurs personnes — le payeur lui-même, ses proches — et
   * règle le tout d'**un seul** paiement.
   *
   * Chaque billet est au nom de son titulaire, au **tarif de son titulaire** :
   * un étudiant du campus ne paie pas le prix externe parce qu'un ami lui
   * offre sa place. Le payeur est mémorisé : c'est à lui que reviennent la
   * facture et un éventuel remboursement.
   *
   * Tout ou rien. Les places sont réservées d'un bloc, et si l'une manque, ou
   * si le paiement est refusé, rien n'est gardé : ni inscription, ni place, ni
   * transaction. Sans cela, on se retrouverait avec trois amis inscrits sur
   * cinq, et un paiement à rembourser.
   */
  async inscrireGroupe(
    evenementId: string,
    payeur: User,
    dto: InscrireGroupeDto,
  ): Promise<GroupeInscrit> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: payeur.role,
    });
    this.verifierOuvert(evenement);

    const participants = await this.resoudreParticipants(
      evenement,
      payeur,
      dto,
    );
    await this.reserverDesPlaces(evenementId, participants.length);

    const payants = participants.filter((p) => p.prix > 0);
    // Un billet que l'on paie pour soi garde sa transaction à son code, comme
    // toujours. Dès qu'on paie pour quelqu'un d'autre, ou pour plusieurs, la
    // référence est celle du groupe : le code d'un billet est son droit
    // d'entrée, et la référence de paiement se retrouve dans l'adresse du
    // retour de Fapshi — elle ne doit pas révéler le billet d'un autre.
    const pourAutrui = payants.some((p) => p.user.id !== payeur.id);
    const groupe =
      payants.length >= 2 || pourAutrui
        ? `GRP-${randomBytes(6).toString('hex').toUpperCase()}`
        : null;

    const creees: Inscription[] = [];
    try {
      for (const participant of participants) {
        creees.push(
          await this.creerPour(evenement, payeur, participant, dto, groupe),
        );
      }
      return await this.lancerLeReglement(
        evenement,
        payeur,
        creees,
        dto,
        groupe,
      );
    } catch (erreur) {
      await this.defaireLeGroupe(
        evenementId,
        participants.length,
        creees,
        groupe,
      );
      throw erreur;
    }
  }

  /**
   * Retrouve une personne à inscrire, avec le prix de son billet.
   *
   * Le prix dépend de **la personne inscrite**, pas de celle qui paie : l'écran
   * d'inscription doit l'afficher avant de payer, sans quoi le total annoncé
   * ne serait pas celui débité.
   */
  async rechercherProches(
    evenementId: string,
    demandeur: { id: string; role: Role },
    recherche: string,
  ): Promise<ProcheAvecTarif[]> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: demandeur.role,
    });
    const proches = await this.userService.rechercherProches(
      demandeur.id,
      recherche,
      evenementId,
    );

    return Promise.all(
      proches.map(async (proche) => {
        const { prixApplicable, tarifCampus } =
          await this.evenementService.detailPour(evenement, {
            promotion: proche.promotion,
          } as User);
        return { ...proche, prix: prixApplicable, tarifCampus };
      }),
    );
  }

  /** Les billets que l'on a payés pour d'autres, sans leurs codes d'entrée. */
  async billetsOfferts(userId: string): Promise<BilletOffert[]> {
    const offerts = await this.inscriptions.find({
      where: { payeur: { id: userId } },
      relations: { user: true, evenement: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    return offerts.map((i) => ({
      id: i.id,
      statut: i.statut,
      statutPaiement: i.statutPaiement,
      prix: i.prix,
      createdAt: i.createdAt,
      evenement: {
        id: i.evenement.id,
        titre: i.evenement.titre,
        dateDebut: i.evenement.dateDebut,
        lieu: i.evenement.lieu,
      },
      beneficiaire: { prenom: i.user.firstName, nom: i.user.lastName },
    }));
  }

  /**
   * Les personnes à inscrire, vérifiées une à une : compte actif et confirmé,
   * pas déjà inscrit, une seule fois dans la liste, avec son propre tarif.
   */
  private async resoudreParticipants(
    evenement: Evenement,
    payeur: User,
    dto: InscrireGroupeDto,
  ): Promise<Participant[]> {
    const vus = new Set<string>();
    const participants: Participant[] = [];

    for (const demande of dto.participants) {
      const user =
        demande.userId && demande.userId !== payeur.id
          ? await this.beneficiaire(demande.userId)
          : payeur;

      if (vus.has(user.id)) {
        throw new BadRequestException(
          'La même personne ne peut figurer qu’une fois dans un paiement.',
        );
      }
      vus.add(user.id);

      await this.verifierPasDejaInscrit(
        evenement.id,
        user.id,
        user.id === payeur.id ? undefined : user,
      );

      const { prixApplicable } = await this.evenementService.detailPour(
        evenement,
        user,
      );
      participants.push({
        user,
        prix: prixApplicable,
        // Les choix obligatoires ne sont exigés que de soi-même : un proche
        // qui n'a pas encore choisi sa taille sera relancé avant le figeage.
        reponses: validerReponses(
          evenement.options ?? [],
          demande.reponses,
          user.id === payeur.id,
        ),
      });
    }

    return participants;
  }

  private async beneficiaire(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user?.isActive || !user.emailVerifieLe) {
      throw new NotFoundException(
        'Cette personne n’est pas inscrite sur la plateforme.',
      );
    }
    return user;
  }

  /** Réserve toutes les places d'un coup, ou aucune. */
  private async reserverDesPlaces(
    evenementId: string,
    nombre: number,
  ): Promise<void> {
    let prises = 0;
    for (let i = 0; i < nombre; i++) {
      if (!(await this.evenementService.reserverUnePlace(evenementId))) {
        await this.libererDesPlaces(evenementId, prises);
        throw new ConflictException(
          nombre === 1
            ? 'Cet événement est complet.'
            : 'Il ne reste pas assez de places pour tous ces billets.',
        );
      }
      prises++;
    }
  }

  private async libererDesPlaces(
    evenementId: string,
    nombre: number,
  ): Promise<void> {
    for (let i = 0; i < nombre; i++) {
      await this.evenementService.libererUnePlace(evenementId);
    }
  }

  private creerPour(
    evenement: Evenement,
    payeur: User,
    participant: Participant,
    dto: InscrireGroupeDto,
    groupe: string | null,
  ): Promise<Inscription> {
    const { user, prix, reponses } = participant;
    const payant = prix > 0;
    const frais = payant
      ? calculerFrais(prix, dto.methodePaiement, this.tauxFrais)
      : null;

    return this.options.enregistrerAvecStock(
      evenement,
      reponses,
      this.inscriptions.create({
        user,
        evenement,
        reponses,
        // Mémorisé seulement quand ce n'est pas soi : un billet que l'on paie
        // pour soi n'a pas de « payeur » à part.
        payeur: user.id === payeur.id ? null : payeur,
        groupePaiement: payant ? groupe : null,
        codeBillet: this.genererCodeBillet(),
        prix,
        frais: frais
          ? {
              fraisFapshi: frais.fraisFapshi,
              fraisRetrait: frais.fraisRetrait,
              montantTtc: frais.montantTtc,
            }
          : AUCUN_FRAIS,
        methodePaiement: dto.methodePaiement ?? null,
        statut: payant
          ? StatutInscription.EN_ATTENTE
          : StatutInscription.CONFIRMEE,
        statutPaiement: payant
          ? StatutPaiement.EN_ATTENTE
          : StatutPaiement.COMPLETE,
      }),
    );
  }

  /** Lance le paiement des billets à régler, puis prévient les personnes concernées. */
  private async lancerLeReglement(
    evenement: Evenement,
    payeur: User,
    creees: Inscription[],
    dto: InscrireGroupeDto,
    groupe: string | null,
  ): Promise<GroupeInscrit> {
    const gratuites = creees.filter(
      (i) => i.statut === StatutInscription.CONFIRMEE,
    );
    const aPayer = creees.filter(
      (i) => i.statut === StatutInscription.EN_ATTENTE,
    );

    let reference = creees[0].codeBillet;
    let urlPaiement: string | null = null;

    if (aPayer.length > 0 && groupe) {
      reference = groupe;
      urlPaiement = await this.lancerPaiementGroupe(
        groupe,
        aPayer,
        evenement,
        dto,
        payeur,
      );
    } else if (aPayer.length === 1) {
      reference = aPayer[0].codeBillet;
      urlPaiement = await this.lancerPaiement(aPayer[0], evenement, dto);
    }

    if (urlPaiement) {
      // Conservée : qui ferme l'onglet avant de payer doit pouvoir y revenir.
      await this.inscriptions.update(
        aPayer.map((i) => i.id),
        { urlPaiement },
      );
    }

    await this.prevenirApresInscription(payeur, evenement, gratuites, aPayer);

    return this.resumeDuGroupe(reference, payeur, creees, aPayer, urlPaiement);
  }

  private async lancerPaiementGroupe(
    reference: string,
    aPayer: Inscription[],
    evenement: Evenement,
    dto: InscrireGroupeDto,
    payeur: User,
  ): Promise<string | null> {
    // La somme de ce que chaque billet doit, frais compris : le payeur règle
    // tout d'un coup, et la transaction porte ce total.
    const montant = aPayer.reduce((t, i) => t + (i.frais.montantTtc ?? 0), 0);
    const fraisPrestataire = aPayer.reduce(
      (t, i) => t + (i.frais.fraisFapshi ?? 0),
      0,
    );

    // Ouverte avant l'appel : un webhook qui arrive pendant l'attente trouve
    // une ligne à mettre à jour.
    await this.transactionService.ouvrir({
      reference,
      montant,
      origine: OrigineTransaction.EVENEMENT,
      user: payeur,
      methodePaiement: dto.methodePaiement ?? null,
      fraisPrestataire,
    });

    const resultat = await this.paiement.initier({
      reference,
      montant,
      methode: dto.methodePaiement ?? null,
      telephone: dto.telephone ?? null,
      description: `Billets (${aPayer.length}) — ${evenement.titre}`,
    });

    if (resultat.referenceExterne) {
      await this.transactionService.enregistrerReferenceExterne(
        reference,
        resultat.referenceExterne,
      );
    }
    if (resultat.statut === StatutPaiement.ECHOUE) {
      throw new BadRequestException(
        'Le paiement a été refusé. Aucune place ne vous a été réservée.',
      );
    }
    // Abouti dès l'appel : aucun webhook ne viendra, on confirme ici.
    if (
      resultat.statut === StatutPaiement.COMPLETE &&
      (await this.transactionService.appliquer(
        reference,
        StatutPaiement.COMPLETE,
      ))
    ) {
      await this.confirmerPaiement(reference);
    }

    return resultat.urlRedirection;
  }

  private async prevenirApresInscription(
    payeur: User,
    evenement: Evenement,
    gratuites: Inscription[],
    aPayer: Inscription[],
  ): Promise<void> {
    for (const billet of gratuites) {
      await this.emettreBilletGratuit(payeur, evenement, billet);
    }

    // Réglé dès l'appel (paiement direct) : les messages de confirmation
    // partent, et non ceux d'une attente.
    const attente = aPayer.filter(
      (i) => i.statut !== StatutInscription.CONFIRMEE,
    );
    for (const billet of aPayer.filter(
      (i) => i.statut === StatutInscription.CONFIRMEE,
    )) {
      await this.apresConfirmation(billet);
    }

    if (attente.length > 0) {
      await this.notificationService.notifier({
        destinataire: payeur,
        type: TypeNotification.EVENEMENT,
        titre: `Inscription en attente de paiement : ${evenement.titre}`,
        message:
          attente.length > 1
            ? `Vos ${attente.length} places sont réservées le temps du paiement.`
            : 'Votre place est réservée le temps du paiement.',
        lien: '/mon-espace/evenements',
        libelleLien: 'Voir mes inscriptions',
      });
    }
  }

  /** Un billet sans rien à payer : valide tout de suite, et dit à qui il est offert. */
  private async emettreBilletGratuit(
    payeur: User,
    evenement: Evenement,
    billet: Inscription,
  ): Promise<void> {
    const offert = billet.user.id !== payeur.id;

    await this.notificationService.notifier({
      destinataire: billet.user,
      type: TypeNotification.EVENEMENT,
      titre: offert
        ? `Vous êtes inscrit(e) : ${evenement.titre}`
        : `Inscription confirmée : ${evenement.titre}`,
      message: offert
        ? `${payeur.firstName} ${payeur.lastName} vous a inscrit(e). Votre billet est valide. Code d'entrée : ${billet.codeBillet}.`
        : `Votre billet est valide. Code d'entrée : ${billet.codeBillet}.`,
      lien: `/billets/${billet.id}`,
      libelleLien: 'Voir mon billet',
    });
    await this.emettreBillet({ ...billet, evenement });
  }

  /** Ce que l'on rend au payeur : l'état de chaque billet, jamais son code d'entrée. */
  private async resumeDuGroupe(
    reference: string,
    payeur: User,
    creees: Inscription[],
    aPayer: Inscription[],
    urlPaiement: string | null,
  ): Promise<GroupeInscrit> {
    const relues = await this.inscriptions.find({
      where: { id: In(creees.map((i) => i.id)) },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    const apayerIds = new Set(aPayer.map((i) => i.id));
    const regle = relues
      .filter((i) => apayerIds.has(i.id))
      .every((i) => i.statut === StatutInscription.CONFIRMEE);

    return {
      reference,
      statutPaiement: regle
        ? StatutPaiement.COMPLETE
        : StatutPaiement.EN_ATTENTE,
      urlPaiement,
      montantDebite: aPayer.reduce((t, i) => t + (i.frais.montantTtc ?? 0), 0),
      billets: relues.map((i) => ({
        id: i.id,
        statut: i.statut,
        prix: i.prix,
        beneficiaire: {
          id: i.user.id,
          prenom: i.user.firstName,
          nom: i.user.lastName,
        },
        pourMoi: i.user.id === payeur.id,
      })),
    };
  }

  /** Défait tout ce qu'un paiement de groupe avait commencé. */
  private async defaireLeGroupe(
    evenementId: string,
    places: number,
    creees: Inscription[],
    groupe: string | null,
  ): Promise<void> {
    for (const inscription of creees) {
      await this.transactionService.abandonner(inscription.codeBillet);
      await this.inscriptions.delete(inscription.id);
    }
    if (groupe) {
      await this.transactionService.abandonner(groupe);
    }
    await this.libererDesPlaces(evenementId, places);
  }

  /**
   * Remet son lot (le T-shirt) à un inscrit, à l'entrée.
   *
   * Réservé à ceux qui tiennent la porte de cet événement. Refusé si le billet
   * n'est pas payé ou annulé, ou si le lot a déjà été remis — et le refus dit
   * quand et par qui : deux portiers ne doivent pas remettre deux T-shirts.
   * La condition est dans la requête : deux remises simultanées ne passent pas
   * toutes les deux.
   */
  async remettre(
    inscriptionId: string,
    portier: { id: string; role: Role },
  ): Promise<Inscription> {
    const inscription = await this.inscriptions.findOne({
      where: { id: inscriptionId },
      relations: { user: true, evenement: true, remisPar: true },
    });
    if (!inscription) {
      throw new NotFoundException('Billet inconnu.');
    }

    if (!(await this.peutScanner(inscription.evenement.id, portier))) {
      throw new ForbiddenException(
        'Vous n’êtes pas affecté au contrôle de cet événement.',
      );
    }
    if (
      inscription.statut === StatutInscription.ANNULEE ||
      inscription.statut === StatutInscription.EN_ATTENTE
    ) {
      throw new ConflictException(
        'Ce billet n’est pas payé ou a été annulé : rien à remettre.',
      );
    }

    const dejaRemis = (i: Inscription) =>
      new ConflictException(
        `Le lot a déjà été remis le ${i.remisLe?.toLocaleString('fr-FR')}` +
          (i.remisPar
            ? ` par ${i.remisPar.firstName} ${i.remisPar.lastName}.`
            : '.'),
      );
    if (inscription.remisLe) {
      throw dejaRemis(inscription);
    }

    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({ remisLe: new Date(), remisPar: { id: portier.id } })
      .where('id = :id AND remis_le IS NULL', { id: inscription.id })
      .execute();

    if (resultat.affected !== 1) {
      throw dejaRemis(
        await this.inscriptions.findOneOrFail({
          where: { id: inscription.id },
          relations: { remisPar: true },
        }),
      );
    }

    return this.inscriptions.findOneOrFail({
      where: { id: inscription.id },
      relations: { user: true, evenement: true, remisPar: true },
    });
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

    const payeur = await this.payeurDuBillet(inscriptionId);
    if (payeur && inscription.statut === StatutInscription.EN_ATTENTE) {
      // Quelqu'un règle ce billet : l'annuler pendant ce temps ferait payer une
      // place qui n'existe plus. Il pourra l'être une fois le paiement tranché.
      throw new ConflictException(
        `${payeur.firstName} ${payeur.lastName} est en train de régler ce billet : ` +
          'il pourra être annulé une fois le paiement confirmé.',
      );
    }

    if (inscription.statut === StatutInscription.EN_ATTENTE) {
      await this.verifierQueLePaiementNEstPasArrive(inscription);
    }

    await this.inscriptions.update(inscriptionId, {
      statut: StatutInscription.ANNULEE,
      urlPaiement: null,
    });
    await this.evenementService.libererUnePlace(inscription.evenement.id);
    await this.expirerLePaiement(inscription.codeBillet);

    if (inscription.prix > 0) {
      // Aucun remboursement automatique : il passe par le prestataire et
      // relève d'une décision du bureau. Le signaler évite de laisser croire
      // que l'argent revient tout seul.
      this.logger.warn(
        `Inscription payée annulée (${inscriptionId}, ${inscription.prix} FCFA) : remboursement à traiter manuellement.`,
      );
      if (payeur) {
        await this.prevenirLePayeurDeLAnnulation(payeur, inscription, userId);
      }
    }
  }

  /** Qui a payé ce billet à la place de son titulaire, le cas échéant. */
  private async payeurDuBillet(inscriptionId: string): Promise<User | null> {
    const avecPayeur = await this.inscriptions.findOne({
      where: { id: inscriptionId },
      relations: { payeur: true },
    });
    return avecPayeur?.payeur ?? null;
  }

  /**
   * Le titulaire annule un billet qu'un autre avait payé : l'argent revient au
   * **payeur**, pas à lui. Le payeur le sait, et la trésorerie aussi, car le
   * remboursement est manuel.
   */
  private async prevenirLePayeurDeLAnnulation(
    payeur: User,
    inscription: Inscription,
    titulaireId: string,
  ): Promise<void> {
    const montant = inscription.frais?.montantTtc ?? inscription.prix;
    const compte = await this.userService.findById(titulaireId);
    const titulaire = compte
      ? `${compte.firstName} ${compte.lastName}`
      : 'Le titulaire';

    await this.notificationService.notifier({
      destinataire: payeur,
      type: TypeNotification.PAIEMENT,
      titre: 'Billet offert annulé',
      message:
        `${titulaire} a annulé le billet que vous aviez payé pour « ${inscription.evenement.titre} ». ` +
        'Le bureau vous rembourse.',
      lien: '/mon-espace/evenements',
      libelleLien: 'Voir mes événements',
    });
    await this.alerteTresorerie.billetOffertAnnule(
      payeur,
      `le billet « ${inscription.evenement.titre} » de ${titulaire}`,
      montant,
    );
  }

  /**
   * Interroge Fapshi avant d'annuler un billet dont le paiement est en attente.
   *
   * Un reseau qui coupe apres la validation sur le telephone laisse l'argent
   * debite et le billet « en attente » : annuler a ce moment-la rendrait la
   * place d'une personne qui a deja paye. Si Fapshi dit « paye », le billet
   * est confirme et l'annulation refusee ; s'il ne repond pas, on s'abstient
   * plutot que d'annuler a l'aveugle.
   */
  private async verifierQueLePaiementNEstPasArrive(
    inscription: Inscription,
  ): Promise<void> {
    // Un billet réglé en groupe n'a pas de transaction à son nom : c'est celle
    // du groupe qui dit s'il est payé.
    const reference = inscription.groupePaiement ?? inscription.codeBillet;
    const transaction = await this.transactionService.trouver(reference);
    if (!transaction?.referenceExterne) {
      return;
    }

    let etat: StatutPaiement;
    try {
      etat = (await this.paiement.verifier(transaction.referenceExterne))
        .statut;
    } catch {
      throw new ConflictException(
        'Impossible de vérifier votre paiement pour le moment : réessayez dans un instant, avant d’annuler.',
      );
    }

    if (etat === StatutPaiement.COMPLETE) {
      await this.transactionService.appliquer(
        reference,
        StatutPaiement.COMPLETE,
      );
      await this.confirmerPaiement(reference);
      throw new ConflictException(
        'Votre paiement est bien arrivé : votre billet est confirmé et n’a pas été annulé.',
      );
    }
  }

  /**
   * Invalide la page de paiement d'un ordre qui vient d'etre annule.
   *
   * Sans cela le lien reste ouvert chez le prestataire : quelqu'un peut encore
   * regler alors que le stock ou la place ont deja ete rendus, et il faudrait
   * rembourser. Le refus de confirmer un ordre annule protege l'integrite ;
   * ceci evite d'avoir a s'en servir.
   *
   * Silencieux sur un paiement deja abouti ou jamais ouvert : il n'y a alors
   * aucun lien a fermer.
   */
  private async expirerLePaiement(reference: string): Promise<void> {
    const transaction = await this.transactionService.trouver(reference);

    if (
      transaction?.referenceExterne &&
      transaction.statut === StatutPaiement.EN_ATTENTE
    ) {
      await this.paiement.expirer(transaction.referenceExterne);
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
  async scanner(
    presente: string,
    portier: { id: string; role: Role },
  ): Promise<Inscription> {
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
    // La fenetre d'abord : inutile de reprocher au portier l'etat d'un billet
    // quand c'est l'heure qui bloque.
    const etat = etatFenetre(
      inscription.evenement.dateDebut,
      inscription.evenement.dateFin,
    );
    if (etat !== EtatFenetre.OUVERTE) {
      throw new ConflictException(motifRefus(etat));
    }

    if (!(await this.peutScanner(inscription.evenement.id, portier))) {
      throw new ForbiddenException(
        'Vous n’êtes pas affecté au contrôle de cet événement.',
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
      .set({
        statut: StatutInscription.UTILISEE,
        scannedAt: new Date(),
        // Rattache le passage a son portier : « quand » sans « qui » ne
        // permet aucune verification a posteriori.
        scannePar: { id: portier.id },
      })
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

    await this.activiteService.journaliser({
      type: TypeActivite.SCAN,
      message:
        `${inscription.user.firstName} ${inscription.user.lastName} est entré ` +
        `à « ${inscription.evenement.titre} ».`,
      auteur: inscription.user,
      metadata: {
        inscriptionId: inscription.id,
        evenementId: inscription.evenement.id,
      },
    });

    return this.inscriptions.findOneOrFail({
      where: { id: inscription.id },
      relations: { user: true, evenement: true },
    });
  }

  /** Confirme une inscription dont le paiement a abouti. */
  /**
   * Défait la confirmation d'un billet dont le paiement a été reconnu à tort.
   *
   * Le billet repasse « en attente » : sa place reste réservée, mais il n'est
   * plus valable à l'entrée. **Refusé s'il a déjà été scanné** — la personne est
   * entrée, on ne reprend pas ce qui a été consommé — ou si l'inscription est
   * annulée.
   *
   * @returns l'identifiant de l'inscription (la source de son reçu), ou `null`
   *   si la référence n'est pas celle d'un billet.
   */
  async annulerConfirmationHorsLigne(
    reference: string,
  ): Promise<string | null> {
    const inscription = await this.inscriptions.findOne({
      where: { codeBillet: reference },
    });
    if (!inscription) {
      return null;
    }

    const refuserSiConsomme = (statut: StatutInscription): void => {
      if (statut === StatutInscription.UTILISEE) {
        throw new ConflictException(
          'Ce billet a déjà été scanné à l’entrée : la validation ne peut plus être annulée.',
        );
      }
      if (statut === StatutInscription.ANNULEE) {
        throw new ConflictException(
          'Cette inscription est annulée : il n’y a plus de validation à défaire.',
        );
      }
    };
    refuserSiConsomme(inscription.statut);

    // Le statut est dans la requête : un scan simultané ne passe pas entre la
    // lecture et l'écriture.
    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({
        statut: StatutInscription.EN_ATTENTE,
        statutPaiement: StatutPaiement.EN_ATTENTE,
      })
      .where('id = :id AND statut = :confirmee', {
        id: inscription.id,
        confirmee: StatutInscription.CONFIRMEE,
      })
      .execute();

    if (resultat.affected !== 1) {
      const relue = await this.inscriptions.findOneByOrFail({
        id: inscription.id,
      });
      refuserSiConsomme(relue.statut);
    }

    return inscription.id;
  }

  async confirmerPaiement(reference: string): Promise<void> {
    const billets = await this.billetsDuPaiement(reference);

    if (billets.length === 0) {
      this.logger.warn(`Paiement reçu pour un billet inconnu : ${reference}`);
      return;
    }

    for (const billet of billets) {
      await this.confirmerUnBillet(billet);
    }
  }

  /**
   * Les billets que règle une référence : un seul quand on a payé le sien, ou
   * plusieurs quand le paiement est groupé.
   */
  private async billetsDuPaiement(reference: string): Promise<Inscription[]> {
    const relations = { user: true, evenement: true, payeur: true };

    const seul = await this.inscriptions.findOne({
      where: { codeBillet: reference },
      relations,
    });
    if (seul) {
      return [seul];
    }

    return this.inscriptions.find({
      where: { groupePaiement: reference },
      relations,
      order: { createdAt: 'ASC' },
    });
  }

  private async confirmerUnBillet(inscription: Inscription): Promise<void> {
    if (inscription.statut === StatutInscription.ANNULEE) {
      // L'argent est arrive apres l'annulation (echec transitoire, annulation
      // faite pendant que la confirmation voyageait, webhook en retard). La
      // personne a paye : on lui rend son billet si la place le permet, et
      // sinon on le dit a la tresorerie, qui rembourse.
      if (!(await this.rouvrirApresPaiement(inscription))) {
        await this.signalerARembourser(inscription);
        return;
      }
    } else if (!(await this.confirmerSiEnAttente(inscription))) {
      return;
    }

    await this.apresConfirmation(inscription);
  }

  /**
   * Conditionnee au statut courant : un second webhook pour la meme reference
   * n'affecte aucune ligne, et la notification ne part qu'une fois.
   *
   * La condition est **dans la requete** et non seulement avant : une
   * annulation concurrente passerait entre la lecture et l'ecriture, et
   * l'inscription serait confirmee malgre tout.
   */
  private async confirmerSiEnAttente(
    inscription: Inscription,
  ): Promise<boolean> {
    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({
        statut: StatutInscription.CONFIRMEE,
        statutPaiement: StatutPaiement.COMPLETE,
        // Le paiement est tranche : le lien n'a plus d'usage, et le laisser
        // offrirait un moyen de payer ce qui est deja regle.
        urlPaiement: null,
      })
      .where(
        'id = :id AND statut_paiement != :complete AND statut != :annulee',
        {
          id: inscription.id,
          complete: StatutPaiement.COMPLETE,
          annulee: StatutInscription.ANNULEE,
        },
      )
      .execute();

    return resultat.affected === 1;
  }

  /**
   * Rend son billet a quelqu'un dont le paiement est arrive apres l'annulation.
   *
   * Ne le fait que si rien n'est pris a personne : l'evenement est toujours
   * ouvert, la personne n'a pas depuis une autre inscription active (deux
   * billets payes pour une seule personne), une place est libre et le choix
   * d'option (la taille de T-shirt) n'est pas epuise. Sinon `false` : le
   * paiement appelle un remboursement.
   */
  private async rouvrirApresPaiement(
    inscription: Inscription,
  ): Promise<boolean> {
    const { evenement } = inscription;
    const fin = evenement.dateFin ?? evenement.dateDebut;

    if (
      evenement.statut === StatutEvenement.ARCHIVE ||
      fin.getTime() <= Date.now() ||
      (await this.aUneAutreInscriptionActive(inscription))
    ) {
      return false;
    }
    if (!(await this.evenementService.reserverUnePlace(evenement.id))) {
      return false;
    }

    let rouverte = false;
    try {
      rouverte = await this.options.rouvrirApresPaiement(
        evenement,
        inscription,
      );
    } finally {
      // Place reprise pour rien : on la rend, y compris si l'ecriture a leve.
      if (!rouverte) {
        await this.evenementService.libererUnePlace(evenement.id);
      }
    }

    return rouverte;
  }

  private async aUneAutreInscriptionActive(
    inscription: Inscription,
  ): Promise<boolean> {
    const autres = await this.inscriptions
      .createQueryBuilder('i')
      .where('i.evenement_id = :evenement AND i.user_id = :user', {
        evenement: inscription.evenement.id,
        user: inscription.user.id,
      })
      .andWhere('i.id != :id AND i.statut != :annulee', {
        id: inscription.id,
        annulee: StatutInscription.ANNULEE,
      })
      .getCount();

    return autres > 0;
  }

  /**
   * Un paiement est arrive pour un billet qu'on ne peut pas rendre : le dire a
   * la personne et a la tresorerie, sans quoi l'argent resterait sans trace.
   */
  private async signalerARembourser(inscription: Inscription): Promise<void> {
    const montant = inscription.frais?.montantTtc ?? inscription.prix;
    this.logger.warn(
      `Paiement recu pour une inscription annulee non reouvrable ` +
        `(${inscription.codeBillet}, ${montant} FCFA) : remboursement a traiter.`,
    );

    await this.alerteTresorerie.aRembourser(
      inscription.user,
      `le billet « ${inscription.evenement.titre} » (${inscription.codeBillet})`,
      montant,
    );
    await this.notificationService.notifier({
      destinataire: inscription.user,
      type: TypeNotification.PAIEMENT,
      titre: 'Paiement reçu, billet indisponible',
      message:
        `Votre paiement pour « ${inscription.evenement.titre} » est bien arrivé, ` +
        'mais votre inscription avait été annulée et il n’est plus possible de ' +
        'la rétablir. Le bureau va vous rembourser : conservez le code ' +
        `${inscription.codeBillet}.`,
      lien: '/billets',
    });
  }

  /** Ce qui suit toute confirmation : prevenir, encaisser, tracer, emettre. */
  private async apresConfirmation(inscription: Inscription): Promise<void> {
    const { user, evenement } = inscription;
    // Quelqu'un d'autre a payé ce billet : il faut le dire aux deux.
    const offreur =
      inscription.payeur && inscription.payeur.id !== user.id
        ? inscription.payeur
        : null;
    const nomTitulaire = `${user.firstName} ${user.lastName}`;

    await this.notificationService.notifier({
      destinataire: user,
      type: TypeNotification.PAIEMENT,
      titre: offreur ? 'Un billet vous est offert' : 'Paiement confirmé',
      message: offreur
        ? `${offreur.firstName} ${offreur.lastName} a payé votre billet pour « ${evenement.titre} ». Il est confirmé. Code : ${inscription.codeBillet}.`
        : `Votre billet pour « ${evenement.titre} » est confirmé. Code : ${inscription.codeBillet}. Votre facture est disponible sur la page du billet.`,
      lien: `/billets/${inscription.id}`,
      libelleLien: offreur
        ? 'Voir mon billet'
        : 'Voir mon billet et ma facture',
    });

    if (offreur) {
      await this.notificationService.notifier({
        destinataire: offreur,
        type: TypeNotification.PAIEMENT,
        titre: 'Billet payé pour un proche',
        message: `Le billet de ${nomTitulaire} pour « ${evenement.titre} » est confirmé. Votre facture est disponible dans vos événements.`,
        lien: '/mon-espace/evenements',
        libelleLien: 'Voir mes événements',
      });
    }

    // La trésorerie apprend ce qui entre. Le montant est celui qui a été
    // débité, frais compris — c'est ce qu'elle retrouvera sur le relevé.
    await this.alerteTresorerie.encaissement({
      origine: 'billetterie',
      payeur: offreur ?? user,
      objet: offreur
        ? `le billet « ${evenement.titre} » de ${nomTitulaire}`
        : `le billet « ${evenement.titre} »`,
      montant: inscription.frais?.montantTtc ?? inscription.prix,
      fraisPrestataire: inscription.frais?.fraisFapshi ?? null,
    });

    const auteur = offreur ?? user;
    await this.activiteService.journaliser({
      type: TypeActivite.PAIEMENT,
      message: offreur
        ? `${auteur.firstName} ${auteur.lastName} a payé le billet de ${nomTitulaire} pour « ${evenement.titre} » (${inscription.prix} FCFA).`
        : `${user.firstName} ${user.lastName} a payé son billet pour « ${evenement.titre} » (${inscription.prix} FCFA).`,
      auteur,
      metadata: {
        inscriptionId: inscription.id,
        evenementId: evenement.id,
        montant: inscription.prix,
        codeBillet: inscription.codeBillet,
        payeurId: auteur.id,
      },
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
    const billets = await this.billetsDuPaiement(reference);

    if (billets.length === 0) {
      this.logger.warn(
        `Échec de paiement pour un billet inconnu : ${reference}`,
      );
      return;
    }

    const refermes: Inscription[] = [];
    for (const billet of billets) {
      if (await this.refermerFauteDePaiement(billet)) {
        refermes.push(billet);
      }
    }
    if (refermes.length === 0) {
      return;
    }

    // Prévenu une seule fois, et c'est celui qui paie : un proche n'a rien
    // demandé et ne sait pas qu'on lui offrait un billet.
    const [premier] = refermes;
    const destinataire = premier.payeur ?? premier.user;
    const pluriel = refermes.length > 1;
    await this.notificationService.notifier({
      destinataire,
      type: TypeNotification.PAIEMENT,
      titre: 'Paiement non abouti',
      message:
        `${pluriel ? 'Vos inscriptions' : 'Votre inscription'} à « ${premier.evenement.titre} » ` +
        `${pluriel ? 'ont été annulées' : 'a été annulée'} : ${motif} ` +
        `${pluriel ? 'Les places sont' : 'La place est'} de nouveau disponible${pluriel ? 's' : ''}, vous pouvez réessayer.`,
      lien: `/evenements/${premier.evenement.id}`,
    });
  }

  /**
   * Referme un billet dont le paiement n'aboutira pas, et rend sa place.
   * `false` quand il ne l'était déjà plus : rien n'est alors rendu deux fois.
   */
  private async refermerFauteDePaiement(
    inscription: Inscription,
  ): Promise<boolean> {
    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({
        statut: StatutInscription.ANNULEE,
        statutPaiement: StatutPaiement.ECHOUE,
        urlPaiement: null,
      })
      .where('id = :id AND statut = :attendu', {
        id: inscription.id,
        attendu: StatutInscription.EN_ATTENTE,
      })
      .execute();

    if (resultat.affected !== 1) {
      return false;
    }

    await this.evenementService.libererUnePlace(inscription.evenement.id);
    this.logger.log(
      `Inscription ${inscription.codeBillet} annulée faute de paiement : place rendue.`,
    );
    return true;
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
    proche?: User,
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
      throw new ConflictException(
        proche
          ? `${proche.firstName} ${proche.lastName} est déjà inscrit(e) à cet événement.`
          : 'Vous êtes déjà inscrit à cet événement.',
      );
    }
  }

  /**
   * Dit si cette personne peut valider les billets de cet evenement.
   *
   * L'administration passe partout ; un portier ne passe que sur l'evenement
   * ou on l'a place. Sans ce rattachement, un portier du gala validerait les
   * billets de la conference du lendemain.
   */
  private async peutScanner(
    evenementId: string,
    portier: { id: string; role: Role },
  ): Promise<boolean> {
    if (estAdministrateur(portier.role)) {
      return true;
    }

    return this.affectations.existsBy({
      evenement: { id: evenementId },
      user: { id: portier.id },
    });
  }

  // ────────────────────────  Portiers d'un evenement  ───────────────────

  /**
   * Place quelqu'un au controle d'un evenement.
   *
   * Idempotent : reaffecter la meme personne ne cree pas de doublon, ce que
   * l'index d'unicite interdirait de toute facon.
   */
  async affecterScanner(
    evenementId: string,
    userId: string,
    parQui: string,
  ): Promise<AffectationScanner> {
    // Les deux existences sont verifiees avant d'ecrire : sans cela, un
    // identifiant errone remonterait en violation de cle etrangere, soit une
    // erreur serveur la ou le bureau merite de s'entendre dire lequel des
    // deux n'existe pas.
    await this.evenementService.trouver(evenementId, { role: Role.ADMIN });
    await this.userService.trouverOuEchouer(userId);

    const existante = await this.affectations.findOne({
      where: { evenement: { id: evenementId }, user: { id: userId } },
      relations: { user: true, affectePar: true },
    });
    if (existante) {
      return existante;
    }

    const creee = await this.affectations.save(
      this.affectations.create({
        evenement: { id: evenementId } as Evenement,
        user: { id: userId } as User,
        affectePar: { id: parQui } as User,
      }),
    );

    // Relue avec ses relations : `save` ne rend que les references passees,
    // et le bureau recevrait deux identifiants nus la ou il attend des noms.
    return this.affectations.findOneOrFail({
      where: { id: creee.id },
      relations: { user: true, affectePar: true },
    });
  }

  /**
   * Retire quelqu'un du controle.
   *
   * Silencieux quand l'affectation n'existe pas : retirer un portier deja
   * retire est le resultat voulu, et une erreur ferait croire a un echec.
   */
  async retirerScanner(evenementId: string, userId: string): Promise<void> {
    await this.affectations.delete({
      evenement: { id: evenementId },
      user: { id: userId },
    });
  }

  /** Qui tient la porte de cet evenement. */
  listerScanners(evenementId: string): Promise<AffectationScanner[]> {
    return this.affectations.find({
      where: { evenement: { id: evenementId } },
      relations: { user: true, affectePar: true },
    });
  }

  /**
   * Efface la trace des portiers au-dela d'une semaine.
   *
   * Le passage lui-meme est conserve — « scannedAt » dit que la personne est
   * entree, et le comptage en depend. Seul le nom du portier s'efface : sa
   * trace sert a verifier un controle recent, et la garder au-dela ferait de
   * la billetterie un fichier de presence du bureau.
   */
  async purgerTracesScan(): Promise<number> {
    const limite = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const resultat = await this.inscriptions
      .createQueryBuilder()
      .update(Inscription)
      .set({ scannePar: null })
      .where('scanne_par_id IS NOT NULL AND scanned_at < :limite', { limite })
      .execute();

    return resultat.affected ?? 0;
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
    dto: Pick<SInscrireDto, 'methodePaiement' | 'telephone'>,
  ): Promise<string | null> {
    // « frais.montantTtc », jamais « prix » : c'est ce total, prix plus les
    // frais Fapshi et de retrait, qu'il faut réellement encaisser — sans quoi
    // chaque vente coûterait un peu d'argent à l'organisation au lieu de lui
    // en rapporter. Non nul ici : lancerPaiement n'est appelé que si l'appel
    // était payant, cas où sInscrire l'a calculé.
    const montant = inscription.frais.montantTtc!;

    // Ouverte **avant** l'appel au prestataire : si le webhook arrive pendant
    // que nous attendons encore la réponse, il trouve une ligne à mettre à
    // jour plutôt que rien, et le paiement n'est pas perdu.
    await this.transactionService.ouvrir({
      reference: inscription.codeBillet,
      montant,
      origine: OrigineTransaction.EVENEMENT,
      user: inscription.user,
      methodePaiement: dto.methodePaiement ?? null,
      fraisPrestataire: inscription.frais.fraisFapshi ?? 0,
    });

    const resultat = await this.paiement.initier({
      // Le code du billet sert de référence : il est unique, et c'est lui qui
      // permet de retrouver l'inscription au retour du webhook.
      reference: inscription.codeBillet,
      montant,
      methode: dto.methodePaiement ?? null,
      telephone: dto.telephone ?? null,
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
        urlPaiement: null,
      });

      // Reporté sur l'objet en mémoire : l'appelant décide d'émettre le billet
      // à partir de lui, et le laisser périmé priverait de billet quiconque
      // paie sans passer par le webhook.
      inscription.statut = StatutInscription.CONFIRMEE;
      inscription.statutPaiement = StatutPaiement.COMPLETE;
    }

    // Rendue a l'appelant : c'est la seule occasion de la transmettre, elle
    // n'est pas conservee en base.
    return resultat.urlRedirection;
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
          id: inscription.id,
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
      libelleLien: confirmee
        ? 'Voir mon billet et ma facture'
        : 'Voir mon inscription',
    });
  }
}
