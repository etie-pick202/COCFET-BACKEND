import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import {
  CreerSondageDto,
  FiltreSondageDto,
  MettreAJourSondageDto,
  ResultatsSondage,
} from './dto/sondage.dto';
import { OptionSondage } from './entities/option-sondage.entity';
import { ParticipationSondage } from './entities/participation-sondage.entity';
import {
  Sondage,
  StatutSondage,
  TypeSondage,
  VisibiliteResultats,
} from './entities/sondage.entity';
import { Vote } from './entities/vote.entity';

const TRIS_AUTORISES = ['deadline', 'createdAt', 'titre'] as const;

/** Code postgres d'une contrainte d'unicité violée. */
const VIOLATION_UNICITE = '23505';

@Injectable()
export class SondageService {
  private readonly logger = new Logger(SondageService.name);

  constructor(
    @InjectRepository(Sondage)
    private readonly sondages: Repository<Sondage>,
    @InjectRepository(ParticipationSondage)
    private readonly participations: Repository<ParticipationSondage>,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {}

  // ─────────────────────────────  Lecture  ──────────────────────────────

  /**
   * Liste les sondages.
   *
   * Un non-administrateur ne voit pas les brouillons, quel que soit le filtre
   * qu'il envoie : un sondage en préparation porte des options encore en
   * discussion, et le connaître à l'avance permettrait de préparer sa réponse.
   */
  async lister(
    filtre: FiltreSondageDto,
    demandeur?: { role: Role },
  ): Promise<ResultatPagine<Sondage>> {
    const administrateur = demandeur?.role === Role.ADMIN;
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    const requete = this.sondages
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.options', 'option')
      .leftJoinAndSelect('s.evenement', 'evenement');

    if (administrateur && filtre.statut) {
      requete.andWhere('s.statut = :statut', { statut: filtre.statut });
    } else if (!administrateur) {
      requete.andWhere('s.statut != :brouillon', {
        brouillon: StatutSondage.BROUILLON,
      });
    }

    if (filtre.ouverts) {
      requete
        .andWhere('s.statut = :actif', { actif: StatutSondage.ACTIF })
        .andWhere('s.deadline > :maintenant', { maintenant: new Date() });
    }
    if (filtre.evenementId) {
      requete.andWhere('s.evenement_id = :evenementId', {
        evenementId: filtre.evenementId,
      });
    }

    requete
      .orderBy(`s.${tri}`, filtre.ordre)
      // Les options gardent l'ordre de saisie : le bureau les a rangées par
      // préférence, et un ordre changeant d'un appel à l'autre déplacerait les
      // cases à cocher sous le doigt du votant.
      // Nom de **propriété**, non de colonne : le constructeur de requêtes
      // résout le chemin via les métadonnées de l'entité, et « created_at »
      // n'y existe pas — la liste répondait 500.
      .addOrderBy('option.createdAt', 'ASC')
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  async trouver(id: string, demandeur?: { role: Role }): Promise<Sondage> {
    const sondage = await this.sondages.findOne({
      where: { id },
      relations: { options: true, evenement: true },
      order: { options: { createdAt: 'ASC' } },
    });

    if (
      !sondage ||
      (sondage.statut === StatutSondage.BROUILLON &&
        demandeur?.role !== Role.ADMIN)
    ) {
      // Même réponse qu'un identifiant inconnu : distinguer les deux
      // révélerait l'existence d'un sondage en préparation, titre compris.
      throw new NotFoundException("Ce sondage n'existe pas.");
    }

    return sondage;
  }

  /**
   * Dépouillement, adapté au demandeur.
   *
   * Les décomptes sont **remplacés par `null`**, jamais simplement omis : le
   * frontend doit pouvoir afficher les options sans connaître les scores, et un
   * champ absent se confondrait avec un score de zéro.
   */
  async resultats(
    id: string,
    userId: string,
    demandeur?: { role: Role },
  ): Promise<ResultatsSondage> {
    const sondage = await this.trouver(id, demandeur);
    const aVote = await this.aDejaVote(id, userId);
    const visibles = this.resultatsVisibles(sondage, aVote);

    return {
      sondageId: sondage.id,
      totalVotes: sondage.totalVotes,
      aVote,
      resultatsVisibles: visibles,
      options: sondage.options.map((option) => ({
        id: option.id,
        texte: option.texte,
        votes: visibles ? option.votes : null,
        pourcentage: visibles
          ? this.part(option.votes, sondage.totalVotes)
          : null,
      })),
    };
  }

  aDejaVote(sondageId: string, userId: string): Promise<boolean> {
    return this.participations.existsBy({
      sondage: { id: sondageId },
      user: { id: userId },
    });
  }

  // ────────────────────────────  Écriture  ──────────────────────────────

  async creer(dto: CreerSondageDto): Promise<Sondage> {
    const deadline = this.deadlineValide(dto.deadline);

    const { options, evenementId, ...reste } = dto;

    const sondage = await this.sondages.save(
      this.sondages.create({
        ...reste,
        deadline,
        ...(evenementId ? { evenement: { id: evenementId } } : {}),
        // `cascade` sur la relation insère les options avec le sondage : deux
        // enregistrements séparés laisseraient exister un sondage sans options.
        options: options.map((texte) => ({ texte, votes: 0 }) as OptionSondage),
        statut: StatutSondage.BROUILLON,
        totalVotes: 0,
      }),
    );

    return this.trouver(sondage.id, { role: Role.ADMIN });
  }

  /**
   * Modifie ce qui reste modifiable.
   *
   * Ni le titre, ni les options, ni le type : une fois le premier bulletin
   * déposé, les changer ferait répondre les votants à une question qu'ils n'ont
   * pas lue. Le DTO ne les accepte donc pas. La date limite, elle, se prolonge
   * — c'est le geste qu'un bureau fait réellement quand la participation est
   * faible.
   */
  async mettreAJour(id: string, dto: MettreAJourSondageDto): Promise<Sondage> {
    const sondage = await this.trouver(id, { role: Role.ADMIN });

    if (sondage.statut === StatutSondage.CLOS) {
      throw new ConflictException(
        'Ce sondage est clos : son dépouillement ne se retouche plus.',
      );
    }

    const { evenementId, ...reste } = dto;

    await this.sondages.update(id, {
      ...reste,
      ...(dto.deadline ? { deadline: this.deadlineValide(dto.deadline) } : {}),
      // `null` détache le sondage de son événement ; l'absence du champ le
      // laisse tel quel. Les confondre rendrait le détachement impossible.
      ...(evenementId !== undefined
        ? { evenement: evenementId === null ? null : { id: evenementId } }
        : {}),
    });

    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Ouvre le sondage au vote et prévient les personnes concernées.
   *
   * Réactiver un sondage déjà actif ne renotifie personne : une prolongation de
   * la date limite ne doit pas réveiller toute la promotion.
   */
  async activer(id: string): Promise<Sondage> {
    const sondage = await this.trouver(id, { role: Role.ADMIN });

    if (sondage.statut === StatutSondage.ACTIF) {
      return sondage;
    }
    if (sondage.statut === StatutSondage.CLOS) {
      throw new ConflictException(
        'Ce sondage est clos : rouvrir le vote invaliderait son dépouillement.',
      );
    }
    if (sondage.deadline.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La date limite est passée : prolongez-la avant d’ouvrir le vote.',
      );
    }

    await this.sondages.update(id, { statut: StatutSondage.ACTIF });

    await this.notificationService.diffuser({
      type: TypeNotification.SONDAGE,
      titre: `Votre avis : ${sondage.titre}`,
      message: `Vous avez jusqu’au ${sondage.deadline.toLocaleDateString('fr-FR')} pour répondre.`,
      lien: `/sondages/${sondage.id}`,
      // Un sondage réservé au campus ne s'annonce pas aux visiteurs : recevoir
      // l'invitation puis un refus au moment de voter serait incompréhensible.
      ...(sondage.campusUniquement ? { roles: [Role.STUDENT] } : {}),
    });

    this.logger.log(`Sondage ouvert au vote : ${sondage.titre}`);

    return this.trouver(id, { role: Role.ADMIN });
  }

  async clore(id: string): Promise<Sondage> {
    await this.trouver(id, { role: Role.ADMIN });
    await this.sondages.update(id, { statut: StatutSondage.CLOS });
    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Supprime un sondage.
   *
   * Refusé dès qu'un bulletin existe : la suppression emporterait en cascade
   * des votes exprimés, et le bureau perdrait la trace d'une consultation qui a
   * eu lieu. La clôture est la sortie prévue.
   */
  async supprimer(id: string): Promise<void> {
    const sondage = await this.trouver(id, { role: Role.ADMIN });

    if (sondage.totalVotes > 0) {
      throw new ForbiddenException(
        `Ce sondage compte ${sondage.totalVotes} vote(s) : clôturez-le plutôt ` +
          'que de le supprimer.',
      );
    }

    await this.sondages.delete(id);
  }

  // ──────────────────────────────  Vote  ────────────────────────────────

  /**
   * Enregistre un bulletin.
   *
   * Tout se joue dans **une seule transaction** : la participation, le
   * bulletin, et les deux compteurs dénormalisés. Séparer ces écritures
   * laisserait des compteurs faux dès le premier échec à mi-parcours, et le
   * dépouillement ne serait plus rattrapable — un compteur ne se recalcule pas
   * à partir de bulletins anonymes qu'on ne sait plus relier à personne.
   *
   * Le double vote est arrêté par l'index unique de `participations_sondage`,
   * **en base** et non en mémoire : deux requêtes simultanées passeraient
   * toutes deux une vérification préalable avant que l'une ait écrit.
   */
  async voter(
    sondageId: string,
    votant: Pick<User, 'id' | 'promotion'>,
    optionIds: string[],
  ): Promise<ResultatsSondage> {
    const sondage = await this.trouver(sondageId, { role: Role.ADMIN });

    this.verifierOuvert(sondage);
    this.verifierEligibilite(sondage, votant);
    const choisies = this.verifierOptions(sondage, optionIds);

    try {
      await this.dataSource.transaction(async (gestionnaire) => {
        await gestionnaire.insert(ParticipationSondage, {
          sondage: { id: sondage.id },
          user: { id: votant.id },
        });

        const bulletin = await gestionnaire.save(
          gestionnaire.create(Vote, {
            sondage: { id: sondage.id },
            // Le lien vers la personne n'existe pas sur un sondage anonyme.
            // C'est la seule différence entre les deux modes, et elle est ici.
            user: sondage.isAnonyme ? null : { id: votant.id },
            options: choisies,
          }),
        );

        await gestionnaire.increment(
          OptionSondage,
          { id: In(choisies.map((option) => option.id)) },
          'votes',
          1,
        );
        // Compte des **votants**, pas des choix exprimés : sur un sondage à
        // choix multiple, additionner les choix rendrait les pourcentages
        // incomparables d'une option à l'autre.
        await gestionnaire.increment(
          Sondage,
          { id: sondage.id },
          'totalVotes',
          1,
        );

        this.logger.log(`Bulletin ${bulletin.id} enregistré.`);
      });
    } catch (erreur) {
      if (this.estDoubleVote(erreur)) {
        throw new ConflictException('Vous avez déjà voté à ce sondage.');
      }
      throw erreur;
    }

    // Sans `demandeur` : le vote a réussi, donc le sondage est ouvert — la
    // règle qui masque les brouillons n'a rien à trancher ici.
    return this.resultats(sondageId, votant.id);
  }

  // ─────────────────────────────  Interne  ──────────────────────────────

  private verifierOuvert(sondage: Sondage): void {
    if (sondage.statut !== StatutSondage.ACTIF) {
      throw new ConflictException(
        sondage.statut === StatutSondage.CLOS
          ? 'Ce sondage est clos.'
          : 'Ce sondage n’est pas encore ouvert au vote.',
      );
    }
    if (sondage.deadline.getTime() <= Date.now()) {
      // La date limite prime sur le statut : une clôture manuelle n'a pas
      // forcément été faite, et un vote après l'heure ne vaut pas.
      throw new ConflictException('La date limite de ce sondage est passée.');
    }
  }

  /**
   * Vérifie l'appartenance au campus quand le sondage l'exige.
   *
   * Le critère est la **promotion**, non le rôle : un administrateur du bureau
   * est étudiant du campus et doit pouvoir répondre, alors que son rôle n'est
   * pas `STUDENT`. Inversement, un visiteur extérieur n'a pas de promotion et
   * n'a pas à peser sur une décision interne.
   */
  private verifierEligibilite(
    sondage: Sondage,
    votant: Pick<User, 'promotion'>,
  ): void {
    if (sondage.campusUniquement && votant.promotion === null) {
      throw new ForbiddenException(
        'Ce sondage est réservé aux membres du campus.',
      );
    }
  }

  /** Confronte les options reçues à celles du sondage, et au type de vote. */
  private verifierOptions(
    sondage: Sondage,
    optionIds: string[],
  ): OptionSondage[] {
    const choisies = sondage.options.filter((option) =>
      optionIds.includes(option.id),
    );

    if (choisies.length !== optionIds.length) {
      // Une option d'un autre sondage incrémenterait un compteur étranger.
      throw new BadRequestException(
        'Une des options choisies n’appartient pas à ce sondage.',
      );
    }
    if (sondage.type === TypeSondage.CHOIX_UNIQUE && optionIds.length !== 1) {
      throw new BadRequestException(
        'Ce sondage n’accepte qu’une seule réponse.',
      );
    }

    return choisies;
  }

  private resultatsVisibles(sondage: Sondage, aVote: boolean): boolean {
    switch (sondage.visibiliteResultats) {
      case VisibiliteResultats.TOUJOURS:
        return true;
      case VisibiliteResultats.APRES_VOTE:
        return aVote;
      case VisibiliteResultats.APRES_DEADLINE:
        return (
          sondage.statut === StatutSondage.CLOS ||
          sondage.deadline.getTime() <= Date.now()
        );
    }
  }

  /** Part des votants, arrondie au dixième. */
  private part(votes: number, total: number): number {
    return total === 0 ? 0 : Math.round((votes / total) * 1000) / 10;
  }

  private deadlineValide(valeur: string): Date {
    const date = new Date(valeur);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('La date limite est invalide.');
    }

    return date;
  }

  private estDoubleVote(erreur: unknown): boolean {
    return (
      erreur instanceof QueryFailedError &&
      (erreur as QueryFailedError & { code?: string }).code ===
        VIOLATION_UNICITE
    );
  }
}
