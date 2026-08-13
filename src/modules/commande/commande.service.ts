import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { ActiviteService } from '../activite/activite.service';
import { TypeActivite } from '../activite/entities/journal-activite.entity';
import { BoutiqueService } from '../boutique/boutique.service';
import { Produit, StatutProduit } from '../boutique/entities/produit.entity';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { PASSERELLE_PAIEMENT } from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { User } from '../user/entities/user.entity';
import {
  CreerCommandeDto,
  FiltreCommandeDto,
  LignePanierDto,
} from './dto/commande.dto';
import { Commande, StatutCommande } from './entities/commande.entity';
import { LigneCommande } from './entities/ligne-commande.entity';

const TRIS_AUTORISES = ['createdAt', 'total', 'statut'] as const;

/** Transitions autorisées. Toute autre est refusée, y compris à un administrateur. */
const TRANSITIONS: Record<StatutCommande, StatutCommande[]> = {
  [StatutCommande.EN_ATTENTE]: [StatutCommande.PAYEE, StatutCommande.ANNULEE],
  [StatutCommande.PAYEE]: [StatutCommande.PRETE, StatutCommande.ANNULEE],
  [StatutCommande.PRETE]: [StatutCommande.RETIREE],
  // Terminales : une commande retirée ou annulée ne revient pas en arrière.
  [StatutCommande.RETIREE]: [],
  [StatutCommande.ANNULEE]: [],
};

/** Ce qu'une ligne a réservé, pour pouvoir le rendre en cas d'échec. */
interface Reservation {
  produitId: string;
  quantite: number;
}

/** Ligne validée, prix figé, prête à être écrite. */
interface LigneAPreparer {
  produit: Produit;
  quantite: number;
  taille: string | null;
  couleur: string | null;
  prix: number;
}

@Injectable()
export class CommandeService {
  private readonly logger = new Logger(CommandeService.name);

  constructor(
    @InjectRepository(Commande)
    private readonly commandes: Repository<Commande>,
    private readonly boutiqueService: BoutiqueService,
    private readonly notificationService: NotificationService,
    private readonly transactionService: TransactionService,
    private readonly activiteService: ActiviteService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly paiement: PasserellePaiement,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Transforme un panier en commande.
   *
   * L'ordre des opérations est ce qui compte, et il reprend celui de la
   * billetterie : le stock est réservé **avant** le paiement, article par
   * article et de façon atomique. Sinon deux personnes pourraient payer le
   * dernier exemplaire, et il faudrait rembourser.
   *
   * Le total est calculé **côté serveur** à partir du tarif applicable au
   * demandeur. Accepter un montant envoyé par le client reviendrait à le
   * laisser fixer son prix.
   */
  async creer(user: User, dto: CreerCommandeDto): Promise<Commande> {
    const reservations: Reservation[] = [];
    let commande: Commande | null = null;

    try {
      const lignes = await this.preparerLignes(user, dto.lignes, reservations);
      const total = lignes.reduce(
        (somme, ligne) => somme + ligne.prix * ligne.quantite,
        0,
      );

      // Commande et lignes dans une seule transaction : une commande sans ses
      // lignes serait un total sans contenu, impossible à préparer.
      commande = await this.dataSource.transaction(async (gestionnaire) => {
        const creee = await gestionnaire.save(
          gestionnaire.create(Commande, {
            user,
            total,
            statut: StatutCommande.EN_ATTENTE,
            statutPaiement: StatutPaiement.EN_ATTENTE,
            methodePaiement: dto.methodePaiement,
            telephone: dto.telephone,
          }),
        );

        await gestionnaire.save(
          lignes.map((ligne) =>
            gestionnaire.create(LigneCommande, { ...ligne, commande: creee }),
          ),
        );

        return creee;
      });

      const urlPaiement = await this.lancerPaiement(commande, dto);
      await this.notifier(
        user,
        'Commande enregistrée',
        `Votre commande de ${total} FCFA est en attente de paiement.`,
        commande.id,
      );

      if (urlPaiement) {
        // Conservee : qui ferme l'onglet avant de payer doit pouvoir revenir
        // a sa commande plutot que de l'annuler pour la refaire.
        await this.commandes.update(commande.id, { urlPaiement });
      }

      return this.trouver(commande.id, user.id);
    } catch (erreur) {
      // Tout est défait, dans l'ordre inverse. Ne rendre que le stock
      // laisserait une commande orpheline, jamais payée mais visible dans
      // « mes commandes ».
      if (commande) {
        // Avant la suppression : la référence de la transaction **est**
        // l'identifiant de la commande.
        await this.transactionService.abandonner(commande.id);
        await this.commandes.delete(commande.id);
      }
      await this.rendreLeStock(reservations);
      throw erreur;
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

  async mesCommandes(
    userId: string,
    filtre: FiltreCommandeDto,
  ): Promise<ResultatPagine<Commande>> {
    return this.paginer(filtre, (requete) =>
      requete.where('c.user_id = :userId', { userId }),
    );
  }

  /** Toutes les commandes. Réservé au bureau. */
  async lister(filtre: FiltreCommandeDto): Promise<ResultatPagine<Commande>> {
    return this.paginer(filtre, (requete) => requete.where('1 = 1'));
  }

  /**
   * Détail d'une commande.
   *
   * Le propriétaire fait partie de la condition quand `userId` est fourni :
   * connaître un identifiant ne suffit pas à lire la commande d'autrui.
   */
  async trouver(id: string, userId?: string): Promise<Commande> {
    const commande = await this.commandes.findOne({
      where: { id, ...(userId ? { user: { id: userId } } : {}) },
      relations: { lignes: { produit: true }, user: true },
    });

    if (!commande) {
      throw new NotFoundException("Cette commande n'existe pas.");
    }

    return commande;
  }

  /**
   * Annulation par le client, tant que la commande n'est pas préparée.
   *
   * Le stock est restitué : les articles retournent en vente, ce qui est tout
   * l'intérêt d'annuler plutôt que de laisser traîner.
   */
  async annuler(id: string, userId: string): Promise<void> {
    const commande = await this.trouver(id, userId);

    if (commande.statut === StatutCommande.ANNULEE) {
      return;
    }
    this.verifierTransition(commande, StatutCommande.ANNULEE);

    await this.commandes.update(id, {
      statut: StatutCommande.ANNULEE,
      urlPaiement: null,
    });
    await this.restituer(commande);
    await this.expirerLePaiement(id);

    if (commande.statutPaiement === StatutPaiement.COMPLETE) {
      // Aucun remboursement automatique : il passe par le prestataire et
      // relève d'une décision du bureau. Le signaler évite de laisser croire
      // que l'argent revient tout seul.
      this.logger.warn(
        `Commande payée annulée (${id}, ${commande.total} FCFA) : remboursement à traiter manuellement.`,
      );
    }
  }

  /** Le bureau signale que la commande est prête au retrait. */
  async marquerPrete(id: string, instructions?: string): Promise<Commande> {
    const commande = await this.trouver(id);
    this.verifierTransition(commande, StatutCommande.PRETE);

    await this.commandes.update(id, { statut: StatutCommande.PRETE });

    await this.notifier(
      commande.user,
      'Votre commande est prête',
      instructions
        ? `Elle vous attend. ${instructions}`
        : 'Elle vous attend au bureau du COCFET.',
      id,
    );

    return this.trouver(id);
  }

  /**
   * Retrait effectif, tracé avec son auteur.
   *
   * Sans cette trace, une commande marquée retirée sans l'être ne laisserait
   * aucun moyen de savoir qui l'a validée.
   */
  async marquerRetiree(id: string, parUtilisateur: string): Promise<Commande> {
    const commande = await this.trouver(id);
    this.verifierTransition(commande, StatutCommande.RETIREE);

    await this.commandes.update(id, { statut: StatutCommande.RETIREE });
    this.logger.log(`Commande ${id} retirée, validée par ${parUtilisateur}.`);

    return this.trouver(id);
  }

  /**
   * Passe la commande en payée. Appelée par le webhook et la réconciliation.
   *
   * Conditionnée au statut de paiement courant dans la requête elle-même :
   * une notification rejouée n'affecte aucune ligne et ne notifie qu'une fois.
   */
  async confirmerPaiement(reference: string): Promise<void> {
    const commande = await this.commandes.findOne({
      where: { id: reference },
      relations: { user: true },
    });

    if (!commande) {
      this.logger.warn(
        `Paiement reçu pour une commande inconnue : ${reference}`,
      );
      return;
    }

    if (commande.statut === StatutCommande.ANNULEE) {
      // Le stock a deja ete rendu, et probablement rachete depuis. Confirmer
      // ici vendrait deux fois le meme article, et afficherait comme payee une
      // commande que le client croit annulee. L'argent, lui, est bien arrive :
      // il appelle un remboursement, pas une confirmation.
      this.logger.warn(
        `Paiement recu pour une commande annulee (${commande.id}, ` +
          `${commande.total} FCFA) : remboursement a traiter manuellement.`,
      );
      return;
    }

    const resultat = await this.commandes
      .createQueryBuilder()
      .update(Commande)
      .set({
        statut: StatutCommande.PAYEE,
        statutPaiement: StatutPaiement.COMPLETE,
        // Le paiement est tranche : le lien n'a plus d'usage, et le laisser
        // offrirait un moyen de payer ce qui est deja regle.
        urlPaiement: null,
      })
      // La condition sur le statut est **dans la requete** et non seulement
      // au-dessus : une annulation concurrente passerait entre la lecture et
      // l'ecriture, et la commande serait confirmee malgre tout.
      .where(
        'id = :id AND statut_paiement != :complete AND statut != :annulee',
        {
          id: commande.id,
          complete: StatutPaiement.COMPLETE,
          annulee: StatutCommande.ANNULEE,
        },
      )
      .execute();

    if (resultat.affected !== 1) {
      return;
    }

    await this.notifier(
      commande.user,
      'Paiement confirmé',
      `Votre commande de ${commande.total} FCFA est payée. Vous serez prévenu dès qu’elle sera prête.`,
      commande.id,
    );

    await this.activiteService.journaliser({
      type: TypeActivite.COMMANDE,
      message:
        `${commande.user.firstName} ${commande.user.lastName} a payé une ` +
        `commande de ${commande.total} FCFA.`,
      auteur: commande.user,
      metadata: { commandeId: commande.id, montant: commande.total },
    });
  }

  /**
   * Referme une commande dont le paiement n'aboutira pas, et rend le stock.
   *
   * Sans ce chemin, un refus laisserait la commande en attente
   * indéfiniment, immobilisant des articles que personne n'achètera.
   */
  async echouerPaiement(reference: string, motif: string): Promise<void> {
    const commande = await this.commandes.findOne({
      where: { id: reference },
      relations: { lignes: { produit: true }, user: true },
    });

    if (!commande) {
      this.logger.warn(
        `Échec de paiement pour une commande inconnue : ${reference}`,
      );
      return;
    }

    const resultat = await this.commandes
      .createQueryBuilder()
      .update(Commande)
      .set({
        statut: StatutCommande.ANNULEE,
        statutPaiement: StatutPaiement.ECHOUE,
        urlPaiement: null,
      })
      .where('id = :id AND statut = :attendu', {
        id: commande.id,
        attendu: StatutCommande.EN_ATTENTE,
      })
      .execute();

    if (resultat.affected !== 1) {
      return;
    }

    await this.restituer(commande);
    await this.notifier(
      commande.user,
      'Paiement non abouti',
      `Votre commande a été annulée : ${motif} Les articles sont de nouveau disponibles.`,
      commande.id,
    );
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  /**
   * Valide chaque ligne, fige son prix, et réserve son stock.
   *
   * Le prix unitaire est **copié** dans la ligne : le tarif du produit peut
   * évoluer, sans que les commandes déjà passées ne changent de total.
   */
  private async preparerLignes(
    user: User,
    panier: LignePanierDto[],
    reservations: Reservation[],
  ): Promise<LigneAPreparer[]> {
    const lignes: LigneAPreparer[] = [];

    for (const ligne of panier) {
      const produit = await this.boutiqueService.trouver(ligne.produitId);
      const { prixApplicable, commandable } =
        await this.boutiqueService.detailPour(produit, user);

      if (!commandable) {
        throw new ConflictException(
          `« ${produit.nom} » n’est pas disponible à la commande.`,
        );
      }

      this.verifierDeclinaisons(produit, ligne);

      // Une précommande se vend sans stock : c'est sa raison d'être, et il n'y
      // a donc rien à réserver.
      if (produit.statut !== StatutProduit.PRECOMMANDE) {
        const reserve = await this.boutiqueService.reserverStock(
          produit.id,
          ligne.quantite,
        );

        if (!reserve) {
          throw new ConflictException(
            `Stock insuffisant pour « ${produit.nom} ».`,
          );
        }

        reservations.push({
          produitId: produit.id,
          quantite: ligne.quantite,
        });
      }

      lignes.push({
        produit,
        quantite: ligne.quantite,
        taille: ligne.taille ?? null,
        couleur: ligne.couleur ?? null,
        prix: prixApplicable,
      });
    }

    return lignes;
  }

  /**
   * Refuse une déclinaison que le produit ne propose pas.
   *
   * Sans ce contrôle, une taille inventée passerait jusqu'au bureau, qui
   * découvrirait à la préparation qu'il ne peut pas honorer la commande.
   */
  private verifierDeclinaisons(produit: Produit, ligne: LignePanierDto): void {
    const controler = (
      libelle: string,
      proposees: string[] | null,
      choisie?: string,
    ) => {
      if (!proposees?.length) {
        return;
      }
      if (!choisie) {
        throw new BadRequestException(
          `« ${produit.nom} » exige de choisir une ${libelle} parmi : ${proposees.join(', ')}.`,
        );
      }
      if (!proposees.includes(choisie)) {
        throw new BadRequestException(
          `« ${choisie} » n’est pas une ${libelle} proposée pour « ${produit.nom} ».`,
        );
      }
    };

    controler('taille', produit.tailles, ligne.taille);
    controler('couleur', produit.couleurs, ligne.couleur);
  }

  private async lancerPaiement(
    commande: Commande,
    dto: CreerCommandeDto,
  ): Promise<string | null> {
    // Ouverte **avant** l'appel au prestataire : si la notification arrive
    // pendant que nous attendons encore la réponse, elle trouve une ligne à
    // mettre à jour plutôt que rien, et le paiement n'est pas perdu.
    await this.transactionService.ouvrir({
      // L'identifiant de la commande sert de référence : il est unique, et
      // c'est lui qui permet de la retrouver au retour du webhook. Une
      // référence dédiée exigerait une colonne de plus sans rien apporter.
      reference: commande.id,
      montant: commande.total,
      origine: OrigineTransaction.BOUTIQUE,
      user: commande.user,
      methodePaiement: dto.methodePaiement,
    });

    const resultat = await this.paiement.initier({
      reference: commande.id,
      montant: commande.total,
      methode: dto.methodePaiement,
      telephone: dto.telephone,
      description: `Commande boutique — ${commande.total} FCFA`,
    });

    if (resultat.referenceExterne) {
      await this.transactionService.enregistrerReferenceExterne(
        commande.id,
        resultat.referenceExterne,
      );
    }

    if (resultat.statut === StatutPaiement.ECHOUE) {
      throw new BadRequestException(
        'Le paiement a été refusé. Aucun article ne vous a été réservé.',
      );
    }

    if (resultat.statut === StatutPaiement.COMPLETE) {
      await this.commandes.update(commande.id, {
        statut: StatutCommande.PAYEE,
        statutPaiement: StatutPaiement.COMPLETE,
        urlPaiement: null,
      });
      commande.statut = StatutCommande.PAYEE;
      commande.statutPaiement = StatutPaiement.COMPLETE;
    }

    // Rendue a l'appelant : c'est la seule occasion de la transmettre, elle
    // n'est pas conservee en base.
    return resultat.urlRedirection;
  }

  /** Rend au catalogue ce qu'une commande avait immobilisé. */
  private async restituer(commande: Commande): Promise<void> {
    const lignes = commande.lignes ?? (await this.trouver(commande.id)).lignes;

    for (const ligne of lignes) {
      if (ligne.produit.statut !== StatutProduit.PRECOMMANDE) {
        await this.boutiqueService.libererStock(
          ligne.produit.id,
          ligne.quantite,
        );
      }
    }
  }

  private async rendreLeStock(reservations: Reservation[]): Promise<void> {
    for (const { produitId, quantite } of reservations) {
      await this.boutiqueService.libererStock(produitId, quantite);
    }
  }

  private verifierTransition(commande: Commande, vers: StatutCommande): void {
    if (!TRANSITIONS[commande.statut].includes(vers)) {
      throw new ConflictException(
        `Une commande ${commande.statut} ne peut pas passer à ${vers}.`,
      );
    }
  }

  private async notifier(
    destinataire: User,
    titre: string,
    message: string,
    commandeId: string,
  ): Promise<void> {
    await this.notificationService.notifier({
      destinataire,
      type: TypeNotification.BOUTIQUE,
      titre,
      message,
      lien: `/commandes/${commandeId}`,
    });
  }

  private async paginer(
    filtre: FiltreCommandeDto,
    portee: (
      requete: ReturnType<Repository<Commande>['createQueryBuilder']>,
    ) => unknown,
  ): Promise<ResultatPagine<Commande>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    const requete = this.commandes
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.lignes', 'l')
      .leftJoinAndSelect('l.produit', 'p');

    portee(requete);

    if (filtre.statut) {
      requete.andWhere('c.statut = :statut', { statut: filtre.statut });
    }

    requete
      .orderBy(`c.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }
}
