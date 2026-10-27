import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { montantLisible } from '../../common/montant';
import { paginer, ResultatPagine } from '../../common/pagination';
import { ActiviteService } from '../activite/activite.service';
import { TypeActivite } from '../activite/entities/journal-activite.entity';
import {
  Evenement,
  StatutEvenement,
} from '../evenement/entities/evenement.entity';
import { MailService } from '../mail/mail.service';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
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
import { CreerDonDto, DestinationDon, FiltreDonDto } from './dto/don.dto';
import { Don, TypeDonateur } from './entities/don.entity';
import { versCsv } from '../tableau-de-bord/export-csv';

/** Ce que l'appelant retient d'un don qui vient d'être lancé. */
export interface DonLance {
  reference: string;
  statut: StatutPaiement;
  /** Page de paiement hébergée, quand le prestataire en impose une. */
  urlPaiement: string | null;
  /** Ce que le donateur est débité, frais compris. */
  montantDebite: number;
}

/** Ce que n'importe qui peut savoir d'un don dont il connaît la référence. */
export interface SuiviDon {
  reference: string;
  statut: StatutPaiement;
  montant: number;
  evenement: string | null;
}

export interface ResumeDons {
  total: number;
  nombre: number;
  general: { montant: number; nombre: number };
  parEvenement: {
    evenementId: string;
    titre: string;
    montant: number;
    nombre: number;
  }[];
}

/** Qui est ce donateur, tel qu'on le dit au comité. */
export function libelleDonateur(don: Don): string {
  if (don.anonyme) {
    return 'Anonyme';
  }
  if (don.typeDonateur === TypeDonateur.ENTREPRISE) {
    return don.raisonSociale ?? 'Entreprise';
  }
  return `${don.prenom ?? ''} ${don.nom ?? ''}`.trim() || 'Donateur';
}

/**
 * Les dons au comité.
 *
 * Un don passe par la passerelle comme n'importe quel paiement : il ouvre une
 * transaction, et c'est l'aiguillage des paiements qui en applique l'issue
 * ici. Ce service ne décide jamais qu'un don est reçu : seul le prestataire le
 * dit.
 *
 * **L'anonymat est réel** : un don anonyme n'enregistre ni nom, ni email, ni
 * compte, même si la personne est connectée. Ce que l'on ne garde pas ne peut
 * pas fuiter.
 */
@Injectable()
export class DonService {
  private readonly logger = new Logger(DonService.name);
  private readonly tauxFrais: TauxFrais;

  constructor(
    @InjectRepository(Don) private readonly dons: Repository<Don>,
    @InjectRepository(Evenement)
    private readonly evenements: Repository<Evenement>,
    @Inject(PASSERELLE_PAIEMENT) private readonly paiement: PasserellePaiement,
    private readonly transactionService: TransactionService,
    private readonly notificationService: NotificationService,
    private readonly alerteTresorerie: AlerteTresorerieService,
    private readonly mailService: MailService,
    private readonly activiteService: ActiviteService,
    config: ConfigService,
  ) {
    this.tauxFrais = tauxFraisDepuisConfig(config);
  }

  /**
   * Lance un don : l'enregistre, ouvre la transaction, demande le paiement.
   *
   * Le donateur est débité de son don **plus** les frais du prestataire et la
   * provision de retrait, comme un billet : sans cela, le comité recevrait
   * moins que ce qui lui a été annoncé.
   */
  async creer(
    dto: CreerDonDto,
    utilisateur: Pick<User, 'id'> | null,
  ): Promise<DonLance> {
    const evenement = await this.evenementVise(dto);
    const frais = calculerFrais(
      dto.montant,
      dto.methodePaiement,
      this.tauxFrais,
    );
    const reference = `DON-${randomBytes(6).toString('hex').toUpperCase()}`;

    const don = await this.dons.save(
      this.dons.create({
        reference,
        montant: dto.montant,
        montantDebite: frais.montantTtc,
        evenement,
        message: dto.message ?? null,
        methodePaiement: dto.methodePaiement ?? null,
        ...this.identite(dto),
        // Jamais de compte pour un don anonyme, même connecté.
        user: !dto.anonyme && utilisateur ? { id: utilisateur.id } : null,
      }),
    );

    // Ouverte avant l'appel : un webhook qui arrive pendant l'attente de la
    // réponse du prestataire trouve ainsi une ligne à mettre à jour.
    await this.transactionService.ouvrir({
      reference,
      montant: frais.montantTtc,
      origine: OrigineTransaction.DON,
      user: don.user,
      methodePaiement: dto.methodePaiement ?? null,
      fraisPrestataire: frais.fraisFapshi,
    });

    try {
      const resultat = await this.paiement.initier({
        reference,
        montant: frais.montantTtc,
        methode: dto.methodePaiement ?? null,
        telephone: dto.telephone ?? null,
        description: evenement
          ? `Don — ${evenement.titre}`
          : 'Don au comité COCFET',
      });

      if (resultat.referenceExterne) {
        await this.transactionService.enregistrerReferenceExterne(
          reference,
          resultat.referenceExterne,
        );
      }
      if (resultat.statut === StatutPaiement.ECHOUE) {
        throw new BadRequestException(
          'Le paiement a été refusé par l’opérateur. Rien n’a été débité.',
        );
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

      return {
        reference,
        statut: resultat.statut,
        urlPaiement: resultat.urlRedirection,
        montantDebite: frais.montantTtc,
      };
    } catch (erreur) {
      await this.transactionService.abandonner(reference);
      await this.dons.update(don.id, { statut: StatutPaiement.ECHOUE });
      throw erreur;
    }
  }

  /** L'état d'un don, pour qui en connaît la référence. */
  async suivre(reference: string): Promise<SuiviDon> {
    const don = await this.dons.findOne({
      where: { reference },
      relations: { evenement: true },
    });
    if (!don) {
      throw new NotFoundException('Ce don est introuvable.');
    }

    return {
      reference: don.reference,
      statut: don.statut,
      montant: don.montant,
      evenement: don.evenement?.titre ?? null,
    };
  }

  /**
   * Applique l'issue d'un paiement de don, d'où qu'elle vienne (notification
   * du prestataire ou réconciliation). Appelée par l'aiguillage des paiements.
   */
  async traiterIssue(
    transaction: Transaction,
    statut: StatutPaiement,
  ): Promise<void> {
    const don = await this.dons.findOne({
      where: { reference: transaction.reference },
      relations: { evenement: true, user: true },
    });
    if (!don) {
      this.logger.warn(`Don inconnu pour ${transaction.reference}.`);
      return;
    }

    // Conditionnée au statut courant : une notification rejouée n'affecte
    // aucune ligne et ne déclenche pas deux fois les messages.
    const resultat = await this.dons
      .createQueryBuilder()
      .update(Don)
      .set({ statut })
      .where('id = :id AND statut != :statut', { id: don.id, statut })
      .execute();
    if (resultat.affected !== 1) {
      return;
    }

    if (statut === StatutPaiement.COMPLETE) {
      await this.apresReception(don);
    } else if (statut === StatutPaiement.ECHOUE) {
      await this.apresEchec(don);
    }
  }

  // ─────────────────────────────  Bureau  ─────────────────────────────

  async lister(filtre: FiltreDonDto): Promise<ResultatPagine<Don>> {
    const requete = this.requeteFiltree(filtre)
      .orderBy('d.createdAt', 'DESC')
      .skip((filtre.page - 1) * filtre.limite)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  /** Ce qui est arrivé, au total, au comité en général, et par événement. */
  async resume(): Promise<ResumeDons> {
    const lignes = await this.dons.manager.query<
      {
        evenement_id: string | null;
        titre: string | null;
        montant: string;
        nombre: string;
      }[]
    >(
      `SELECT d.evenement_id, e.titre,
              COALESCE(SUM(d.montant), 0) AS montant, COUNT(*) AS nombre
         FROM dons d
         LEFT JOIN evenements e ON e.id = d.evenement_id
        WHERE d.statut = $1
        GROUP BY d.evenement_id, e.titre
        ORDER BY montant DESC`,
      [StatutPaiement.COMPLETE],
    );

    const resume: ResumeDons = {
      total: 0,
      nombre: 0,
      general: { montant: 0, nombre: 0 },
      parEvenement: [],
    };

    for (const ligne of lignes) {
      const montant = Number(ligne.montant);
      const nombre = Number(ligne.nombre);
      resume.total += montant;
      resume.nombre += nombre;

      if (ligne.evenement_id) {
        resume.parEvenement.push({
          evenementId: ligne.evenement_id,
          titre: ligne.titre ?? '',
          montant,
          nombre,
        });
      } else {
        resume.general = { montant, nombre };
      }
    }

    return resume;
  }

  async exporterCsv(filtre: FiltreDonDto): Promise<string> {
    const dons = await this.requeteFiltree(filtre)
      .orderBy('d.createdAt', 'DESC')
      .getMany();

    return versCsv(
      [
        'Date',
        'Reference',
        'Statut',
        'Destination',
        'Donateur',
        'Type',
        'Email',
        'Telephone',
        'Montant FCFA',
        'Message',
      ],
      dons.map((d) => [
        d.createdAt.toISOString(),
        d.reference,
        d.statut,
        d.evenement?.titre ?? 'Comité en général',
        libelleDonateur(d),
        d.typeDonateur,
        d.email,
        d.telephoneContact,
        d.montant,
        d.message,
      ]),
    );
  }

  // ─────────────────────────────  Interne  ────────────────────────────

  private requeteFiltree(filtre: FiltreDonDto): SelectQueryBuilder<Don> {
    const requete = this.dons
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.evenement', 'e')
      // Par défaut, les dons reçus : ceux restés en attente ou échoués ne sont
      // pas de l'argent.
      .where('d.statut = :statut', {
        statut: filtre.statut ?? StatutPaiement.COMPLETE,
      });

    if (filtre.evenementId) {
      requete.andWhere('d.evenement_id = :evenementId', {
        evenementId: filtre.evenementId,
      });
    }
    if (filtre.general) {
      requete.andWhere('d.evenement_id IS NULL');
    }
    if (filtre.depuis) {
      requete.andWhere('d.created_at >= :depuis', {
        depuis: new Date(filtre.depuis),
      });
    }
    if (filtre.jusqua) {
      requete.andWhere('d.created_at <= :jusqua', {
        jusqua: new Date(filtre.jusqua),
      });
    }

    return requete;
  }

  /** L'événement visé, ou `null` pour un don au comité en général. */
  private async evenementVise(dto: CreerDonDto): Promise<Evenement | null> {
    if (dto.destination === DestinationDon.GENERAL) {
      return null;
    }

    const evenement = await this.evenements.findOne({
      where: { id: dto.evenementId },
    });
    if (!evenement || evenement.statut !== StatutEvenement.PUBLIE) {
      throw new BadRequestException(
        'Cet événement n’accepte pas de dons : choisissez-en un autre, ou donnez au comité en général.',
      );
    }

    return evenement;
  }

  /**
   * L'identité à conserver. Rien pour un don anonyme ; pour un don connu,
   * seulement ce qui correspond à son type — le nom d'une entreprise n'a rien à
   * faire dans les champs d'un particulier.
   */
  private identite(
    dto: CreerDonDto,
  ): Pick<
    Don,
    | 'anonyme'
    | 'typeDonateur'
    | 'prenom'
    | 'nom'
    | 'raisonSociale'
    | 'contact'
    | 'email'
    | 'telephoneContact'
  > {
    if (dto.anonyme) {
      return {
        anonyme: true,
        typeDonateur: null,
        prenom: null,
        nom: null,
        raisonSociale: null,
        contact: null,
        email: null,
        telephoneContact: null,
      };
    }

    const entreprise = dto.typeDonateur === TypeDonateur.ENTREPRISE;
    return {
      anonyme: false,
      typeDonateur: dto.typeDonateur ?? null,
      prenom: entreprise ? null : (dto.prenom ?? null),
      nom: entreprise ? null : (dto.nom ?? null),
      raisonSociale: entreprise ? (dto.raisonSociale ?? null) : null,
      contact: entreprise ? (dto.contact ?? null) : null,
      email: dto.email ?? null,
      telephoneContact: dto.telephoneContact ?? null,
    };
  }

  private destinationLisible(don: Don): string {
    return don.evenement
      ? `l’événement « ${don.evenement.titre} »`
      : 'le comité';
  }

  private async apresReception(don: Don): Promise<void> {
    const libelle = libelleDonateur(don);

    await this.alerteTresorerie.donRecu(
      libelle,
      don.montant,
      don.evenement?.titre ?? null,
      don.user?.id ?? null,
    );

    await this.activiteService.journaliser({
      type: TypeActivite.PAIEMENT,
      message:
        `Don de ${montantLisible(don.montant)} reçu de ${libelle} ` +
        `pour ${this.destinationLisible(don)}.`,
      auteur: don.user ?? undefined,
      metadata: {
        donId: don.id,
        evenementId: don.evenement?.id ?? null,
        montant: don.montant,
        anonyme: don.anonyme,
      },
    });

    const merci =
      `Votre don de ${montantLisible(don.montant)} pour ${this.destinationLisible(don)} ` +
      'nous est bien parvenu. Merci pour votre générosité : il compte pour nous.';

    if (don.user) {
      await this.notificationService.notifier({
        destinataire: don.user,
        type: TypeNotification.PAIEMENT,
        titre: 'Merci pour votre don',
        message: merci,
        lien: '/',
        libelleLien: 'Retour à l’accueil',
      });
    }

    // Le remerciement par email part même sans compte : c'est le seul moyen de
    // joindre un donateur connu qui n'est pas inscrit.
    if (!don.anonyme && don.email) {
      try {
        await this.mailService.envoyerNotification(
          don.email,
          don.typeDonateur === TypeDonateur.ENTREPRISE
            ? (don.contact ?? don.raisonSociale ?? '')
            : (don.prenom ?? ''),
          'Merci pour votre don',
          merci,
          null,
        );
      } catch (erreur) {
        // Le don est reçu, le remerciement est une politesse : un email qui
        // part mal ne doit pas le défaire.
        this.logger.warn(
          `Remerciement non envoyé pour ${don.reference} : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }
  }

  private async apresEchec(don: Don): Promise<void> {
    if (!don.user) {
      return;
    }

    await this.notificationService.notifier({
      destinataire: don.user,
      type: TypeNotification.PAIEMENT,
      titre: 'Don non abouti',
      message:
        `Votre don de ${montantLisible(don.montant)} n’a pas abouti. ` +
        'Rien n’a été débité : vous pouvez réessayer quand vous voulez.',
      lien: '/don',
      libelleLien: 'Faire un don',
    });
  }
}
