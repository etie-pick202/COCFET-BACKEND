import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { Evenement } from '../evenement/entities/evenement.entity';
import { EvenementService } from '../evenement/evenement.service';
import {
  dateFigeage,
  lireUtilisations,
  OptionEvenement,
  reponsesCompletes,
  Reponses,
  Utilisation,
  validerReponses,
} from '../evenement/options';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { versCsv } from '../tableau-de-bord/export-csv';
import { Inscription, StatutInscription } from './entities/inscription.entity';

/** Une valeur proposée, avec ce qu'il en reste. */
export interface ChoixConsulte {
  valeur: string;
  /** Places restantes ; `null` quand le stock est illimité. */
  restant: number | null;
  epuise: boolean;
}

export interface OptionConsultee {
  cle: string;
  libelle: string;
  obligatoire: boolean;
  choix: ChoixConsulte[];
}

export interface OptionsConsultees {
  options: OptionConsultee[];
  /** Instant où les choix se figent ; `null` s'il n'y a aucune option. */
  figeLe: Date | null;
  /** Vrai tant que les inscrits peuvent encore changer leur choix. */
  modifiable: boolean;
}

export interface ChoixRecapitule {
  valeur: string;
  stock: number | null;
  confirmees: number;
  enAttente: number;
  restant: number | null;
}

export interface OptionRecapitulee {
  cle: string;
  libelle: string;
  choix: ChoixRecapitule[];
  /** Inscrits (non annulés) qui n'ont pas encore répondu à cette option. */
  sansReponse: { confirmees: number; enAttente: number };
}

/**
 * Les options d'un événement, côté inscrits : consulter ce qui reste, changer
 * son choix, et — pour le bureau — compter, exporter, relancer.
 *
 * **Le stock est tenu sous verrou.** Deux personnes qui prennent le dernier
 * T-shirt XL au même instant ne doivent pas l'obtenir toutes les deux : le
 * contrôle et l'écriture se font dans une transaction qui détient un verrou
 * propre à l'événement, si bien qu'elles passent l'une après l'autre.
 */
@Injectable()
export class OptionsEvenementService {
  private readonly logger = new Logger(OptionsEvenementService.name);

  constructor(
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    @InjectRepository(Evenement)
    private readonly evenements: Repository<Evenement>,
    private readonly evenementService: EvenementService,
    private readonly notificationService: NotificationService,
  ) {}

  // ─────────────────────────  Côté inscrit  ─────────────────────────

  async consulter(
    evenementId: string,
    demandeur?: { role: Role },
  ): Promise<OptionsConsultees> {
    const evenement = await this.evenementService.trouver(
      evenementId,
      demandeur,
    );
    const options = evenement.options ?? [];
    const utilisations = await lireUtilisations(
      this.evenements.manager,
      evenement.id,
    );

    const figeLe =
      options.length > 0
        ? dateFigeage(evenement.dateDebut, evenement.optionsFigeesAvantJours)
        : null;

    return {
      options: options.map((option) => ({
        cle: option.cle,
        libelle: option.libelle,
        obligatoire: option.obligatoire,
        choix: option.choix.map((choix) => {
          const restant = this.restant(
            choix.stock,
            option.cle,
            choix.valeur,
            utilisations,
          );
          return {
            valeur: choix.valeur,
            restant,
            epuise: restant !== null && restant <= 0,
          };
        }),
      })),
      figeLe,
      modifiable: figeLe === null || new Date() < figeLe,
    };
  }

  /**
   * Enregistre une inscription en retenant le stock des choix faits.
   *
   * Sans stock en jeu, c'est une simple écriture. Avec, le contrôle et
   * l'écriture partagent une transaction sous verrou : sans cela, deux
   * inscriptions simultanées pourraient dépasser le stock.
   */
  async enregistrerAvecStock(
    evenement: Evenement,
    reponses: Reponses,
    inscription: Inscription,
  ): Promise<Inscription> {
    const options = evenement.options ?? [];
    // Seul le stock de la valeur **choisie** compte : prendre une taille
    // illimitée n'a pas à passer sous verrou.
    const aDuStock = options.some(
      (o) => o.choix.find((c) => c.valeur === reponses[o.cle])?.stock != null,
    );

    if (!aDuStock) {
      return this.inscriptions.save(inscription);
    }

    return this.inscriptions.manager.transaction(async (gestionnaire) => {
      await this.verrouiller(gestionnaire, evenement.id);
      await this.verifierStock(gestionnaire, evenement, reponses, null);
      return gestionnaire.save(inscription);
    });
  }

  /**
   * Change le choix d'un inscrit, tant que l'événement n'est pas figé.
   *
   * Refusé une fois la date de figeage passée — les T-shirts sont commandés —,
   * si le lot a déjà été remis, ou si la nouvelle valeur est épuisée.
   */
  async modifierReponses(
    inscriptionId: string,
    userId: string,
    brutes: unknown,
  ): Promise<Inscription> {
    const inscription = await this.inscriptions.findOne({
      where: { id: inscriptionId, user: { id: userId } },
      relations: { evenement: true, user: true },
    });
    if (!inscription) {
      throw new NotFoundException("Ce billet n'existe pas.");
    }

    if (inscription.statut === StatutInscription.ANNULEE) {
      throw new ConflictException('Cette inscription est annulée.');
    }
    if (inscription.statut === StatutInscription.UTILISEE) {
      throw new ConflictException(
        'Ce billet a déjà été utilisé : le choix ne peut plus changer.',
      );
    }
    if (inscription.remisLe) {
      throw new ConflictException(
        'Votre lot vous a déjà été remis : le choix ne peut plus changer.',
      );
    }

    const evenement = inscription.evenement;
    const options = evenement.options ?? [];
    const figeLe = dateFigeage(
      evenement.dateDebut,
      evenement.optionsFigeesAvantJours,
    );
    if (new Date() >= figeLe) {
      throw new ConflictException(
        `Les choix sont figés depuis le ${figeLe.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
        })} : la commande est partie. Rapprochez-vous du bureau.`,
      );
    }

    const reponses = validerReponses(options, brutes, true);

    await this.inscriptions.manager.transaction(async (gestionnaire) => {
      await this.verrouiller(gestionnaire, evenement.id);
      await this.verifierStock(
        gestionnaire,
        evenement,
        reponses,
        inscription.id,
      );
      await gestionnaire.update(Inscription, inscription.id, { reponses });
    });

    return this.inscriptions.findOneOrFail({
      where: { id: inscription.id },
      relations: { evenement: true },
    });
  }

  // ─────────────────────────  Côté bureau  ──────────────────────────

  /**
   * Combien d'inscrits ont choisi chaque valeur, et ce qu'il reste.
   *
   * C'est le chiffre à porter au fournisseur : les inscriptions **payées**
   * d'abord, celles en attente à part — elles peuvent encore tomber.
   */
  async recapitulatif(evenementId: string): Promise<OptionRecapitulee[]> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: Role.ADMIN,
    });
    const options = evenement.options ?? [];
    const utilisations = await lireUtilisations(
      this.evenements.manager,
      evenement.id,
    );

    return Promise.all(
      options.map(async (option) => ({
        cle: option.cle,
        libelle: option.libelle,
        choix: option.choix.map((choix) => {
          const u = utilisations.find(
            (x) => x.cle === option.cle && x.valeur === choix.valeur,
          );
          const confirmees = u?.confirmees ?? 0;
          const enAttente = u?.enAttente ?? 0;
          return {
            valeur: choix.valeur,
            stock: choix.stock,
            confirmees,
            enAttente,
            restant:
              choix.stock === null
                ? null
                : choix.stock - confirmees - enAttente,
          };
        }),
        sansReponse: await this.compterSansReponse(evenement.id, option.cle),
      })),
    );
  }

  /** Les inscrits et leurs choix, au format tableur. */
  async exporterCsv(evenementId: string): Promise<string> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: Role.ADMIN,
    });
    const options = evenement.options ?? [];

    const inscrits = await this.inscriptions.find({
      where: { evenement: { id: evenement.id } },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    return versCsv(
      [
        'Nom',
        'Prenom',
        'Email',
        'Statut',
        ...options.map((o) => o.libelle),
        'Remis le',
      ],
      inscrits
        .filter((i) => i.statut !== StatutInscription.ANNULEE)
        .map((i) => [
          i.user.lastName,
          i.user.firstName,
          i.user.email,
          i.statut,
          ...options.map((o) => i.reponses?.[o.cle] ?? ''),
          i.remisLe ? i.remisLe.toISOString() : '',
        ]),
    );
  }

  /**
   * Demande leur choix à ceux qui n'ont pas répondu.
   *
   * Utile surtout quand les options sont ajoutées **après** les premières
   * inscriptions : ces personnes n'ont jamais vu la question.
   *
   * @returns le nombre de personnes prévenues.
   */
  async relancer(evenementId: string): Promise<number> {
    const evenement = await this.evenementService.trouver(evenementId, {
      role: Role.ADMIN,
    });
    const options = evenement.options ?? [];
    if (options.length === 0) {
      return 0;
    }

    const inscrits = await this.inscriptions.find({
      where: { evenement: { id: evenement.id } },
      relations: { user: true },
    });
    const sansReponse = inscrits.filter(
      (i) =>
        i.statut !== StatutInscription.ANNULEE &&
        !reponsesCompletes(options, i.reponses),
    );

    const figeLe = dateFigeage(
      evenement.dateDebut,
      evenement.optionsFigeesAvantJours,
    );
    for (const inscrit of sansReponse) {
      await this.notificationService.notifier({
        destinataire: inscrit.user,
        type: TypeNotification.EVENEMENT,
        titre: `Votre choix pour « ${evenement.titre} »`,
        message:
          `Choisissez ${options.map((o) => o.libelle.toLowerCase()).join(', ')} ` +
          `avant le ${figeLe.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
          })} : ensuite, la commande part et le choix ne pourra plus changer.`,
        lien: `/billets/${inscrit.id}`,
        libelleLien: 'Faire mon choix',
      });
    }

    this.logger.log(
      `${sansReponse.length} inscrit(s) relancé(s) pour « ${evenement.titre} ».`,
    );

    return sansReponse.length;
  }

  // ─────────────────────────────  Interne  ──────────────────────────

  /** Verrou propre à l'événement, relâché à la fin de la transaction. */
  private async verrouiller(
    gestionnaire: EntityManager,
    evenementId: string,
  ): Promise<void> {
    await gestionnaire.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `options:${evenementId}`,
    ]);
  }

  private async verifierStock(
    gestionnaire: EntityManager,
    evenement: Evenement,
    reponses: Reponses,
    exclureInscription: string | null,
  ): Promise<void> {
    const utilisations = await lireUtilisations(
      gestionnaire,
      evenement.id,
      exclureInscription,
    );

    for (const option of evenement.options ?? []) {
      const valeur = reponses[option.cle];
      const choix = option.choix.find((c) => c.valeur === valeur);
      if (!choix || choix.stock === null) {
        continue;
      }

      const restant = this.restant(
        choix.stock,
        option.cle,
        choix.valeur,
        utilisations,
      );
      if (restant !== null && restant <= 0) {
        throw new ConflictException(
          `${option.libelle} « ${choix.valeur} » est épuisé : choisissez-en un autre.`,
        );
      }
    }
  }

  private restant(
    stock: number | null,
    cle: string,
    valeur: string,
    utilisations: Utilisation[],
  ): number | null {
    if (stock === null) {
      return null;
    }
    const u = utilisations.find((x) => x.cle === cle && x.valeur === valeur);
    return stock - (u?.confirmees ?? 0) - (u?.enAttente ?? 0);
  }

  private async compterSansReponse(
    evenementId: string,
    cle: string,
  ): Promise<{ confirmees: number; enAttente: number }> {
    const [ligne] = await this.inscriptions.manager.query<
      { confirmees: string; en_attente: string }[]
    >(
      `SELECT COUNT(*) FILTER (WHERE statut IN ('CONFIRMEE', 'UTILISEE')) AS confirmees,
              COUNT(*) FILTER (WHERE statut = 'EN_ATTENTE') AS en_attente
         FROM inscriptions
        WHERE evenement_id = $1
          AND statut <> 'ANNULEE'
          AND NOT jsonb_exists(reponses, $2)`,
      [evenementId, cle],
    );

    return {
      confirmees: Number(ligne?.confirmees ?? 0),
      enAttente: Number(ligne?.en_attente ?? 0),
    };
  }
}

export type { OptionEvenement };
