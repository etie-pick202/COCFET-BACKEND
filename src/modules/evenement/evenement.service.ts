import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, MoreThan, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { beneficieDuTarifCampus } from '../../common/identite/identite-campus';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { GenerationService } from '../generation/generation.service';
import { TypeNotification } from '../notification/entities/notification.entity';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import {
  CreerEvenementDto,
  EvenementAvecTarif,
  FiltreEvenementDto,
  MettreAJourEvenementDto,
} from './dto/evenement.dto';
import {
  Evenement,
  StatutEvenement,
  TypeEvenement,
} from './entities/evenement.entity';

const TRIS_AUTORISES = ['dateDebut', 'createdAt', 'titre'] as const;

@Injectable()
export class EvenementService {
  private readonly logger = new Logger(EvenementService.name);

  constructor(
    @InjectRepository(Evenement)
    private readonly evenements: Repository<Evenement>,
    private readonly generationService: GenerationService,
    private readonly notificationService: NotificationService,
  ) {}

  // ─────────────────────────────  Lecture  ──────────────────────────────

  /**
   * Liste les événements.
   *
   * Un non-administrateur ne voit que les événements **publiés**, quel que
   * soit le filtre qu'il envoie : un brouillon porte des tarifs et des dates
   * encore en discussion, et une archive n'a plus vocation à être proposée.
   */
  async lister(
    filtre: FiltreEvenementDto,
    demandeur?: { role: Role },
  ): Promise<ResultatPagine<Evenement>> {
    const administrateur = demandeur?.role === Role.ADMIN;
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'dateDebut');

    const requete = this.evenements
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.sponsors', 'sponsor');

    if (administrateur) {
      if (filtre.statut) {
        requete.andWhere('e.statut = :statut', { statut: filtre.statut });
      }
    } else {
      requete.andWhere('e.statut = :publie', {
        publie: StatutEvenement.PUBLIE,
      });
    }

    if (filtre.type) {
      requete.andWhere('e.type = :type', { type: filtre.type });
    }
    if (filtre.aVenir) {
      requete.andWhere('e.date_debut > :maintenant', {
        maintenant: new Date(),
      });
    }
    if (filtre.recherche) {
      // Paramétré, jamais concaténé : la valeur vient du client.
      const motif = `%${filtre.recherche}%`;
      requete.andWhere(
        new Brackets((q) =>
          q
            .where('e.titre ILIKE :motif', { motif })
            .orWhere('e.lieu ILIKE :motif', { motif }),
        ),
      );
    }

    requete
      .orderBy(`e.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  async trouver(id: string, demandeur?: { role: Role }): Promise<Evenement> {
    const evenement = await this.evenements.findOne({
      where: { id },
      relations: { sponsors: true, generation: true },
    });

    if (!evenement) {
      throw new NotFoundException("Cet événement n'existe pas.");
    }

    if (
      evenement.statut !== StatutEvenement.PUBLIE &&
      demandeur?.role !== Role.ADMIN
    ) {
      // Même réponse qu'un identifiant inconnu : distinguer les deux
      // révélerait l'existence d'un brouillon, avec son titre dans l'URL.
      throw new NotFoundException("Cet événement n'existe pas.");
    }

    return evenement;
  }

  /**
   * Tarif applicable à une personne donnée, et état des places.
   *
   * Le tarif **ne découle pas du rôle** mais de la promotion : un ancien reste
   * `STUDENT` après son départ, et paie pourtant le tarif externe. C'est la
   * comparaison à la génération active qui tranche.
   */
  async detailPour(
    evenement: Evenement,
    user?: User,
  ): Promise<EvenementAvecTarif> {
    const generation = await this.generationService.trouverActive();
    const tarifCampus =
      generation !== null &&
      user !== undefined &&
      beneficieDuTarifCampus(user.promotion, generation.annee);

    const illimite = evenement.capaciteMax === 0;
    const restantes = illimite
      ? null
      : Math.max(0, evenement.capaciteMax - evenement.inscriptionsActuelles);

    return {
      prixApplicable: this.prixApplicable(evenement, tarifCampus),
      tarifCampus,
      placesRestantes: restantes,
      complet: restantes !== null && restantes === 0,
    };
  }

  private prixApplicable(evenement: Evenement, tarifCampus: boolean): number {
    if (evenement.type === TypeEvenement.GRATUIT) {
      return 0;
    }
    return tarifCampus ? evenement.prixCampus : evenement.prixExterne;
  }

  // ────────────────────────────  Écriture  ──────────────────────────────

  async creer(dto: CreerEvenementDto): Promise<Evenement> {
    this.verifierDates(dto.dateDebut, dto.dateFin);

    const generation = await this.generationService.trouverActive();

    return this.evenements.save(
      this.evenements.create({
        ...dto,
        dateDebut: new Date(dto.dateDebut),
        dateFin: dto.dateFin ? new Date(dto.dateFin) : null,
        // Rattaché au mandat en cours : c'est ce qui permettra, une fois la
        // génération archivée, de retrouver les événements de chaque promotion.
        generation,
        statut: StatutEvenement.BROUILLON,
      }),
    );
  }

  async mettreAJour(
    id: string,
    dto: MettreAJourEvenementDto,
  ): Promise<Evenement> {
    const evenement = await this.trouver(id, { role: Role.ADMIN });

    const debut = dto.dateDebut ?? evenement.dateDebut.toISOString();
    const fin = dto.dateFin ?? evenement.dateFin?.toISOString() ?? undefined;
    this.verifierDates(debut, fin);

    if (
      dto.capaciteMax !== undefined &&
      dto.capaciteMax !== 0 &&
      dto.capaciteMax < evenement.inscriptionsActuelles
    ) {
      // Réduire la capacité sous le nombre d'inscrits invaliderait des billets
      // déjà vendus. Le bureau doit annuler des inscriptions d'abord.
      throw new BadRequestException(
        `Cet événement compte déjà ${evenement.inscriptionsActuelles} inscrit(s) : ` +
          'la capacité ne peut pas être réduite en dessous.',
      );
    }

    await this.evenements.update(id, {
      ...dto,
      ...(dto.dateDebut ? { dateDebut: new Date(dto.dateDebut) } : {}),
      ...(dto.dateFin ? { dateFin: new Date(dto.dateFin) } : {}),
    });

    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Publie l'événement et prévient les personnes concernées.
   *
   * La publication est le seul moment où une diffusion part : republier un
   * événement déjà publié ne renotifie personne, sans quoi une correction de
   * faute de frappe alerterait toute la promotion.
   */
  async publier(id: string): Promise<Evenement> {
    const evenement = await this.trouver(id, { role: Role.ADMIN });

    if (evenement.statut === StatutEvenement.PUBLIE) {
      return evenement;
    }
    if (evenement.statut === StatutEvenement.ARCHIVE) {
      throw new BadRequestException(
        'Un événement archivé ne peut pas être republié.',
      );
    }
    if (evenement.dateDebut.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La date de cet événement est passée : corrigez-la avant de publier.',
      );
    }

    await this.evenements.update(id, { statut: StatutEvenement.PUBLIE });

    await this.notificationService.diffuser({
      type: TypeNotification.EVENEMENT,
      titre: `Nouvel événement : ${evenement.titre}`,
      message: `${evenement.titre} — ${evenement.lieu}, le ${evenement.dateDebut.toLocaleDateString('fr-FR')}.`,
      lien: `/evenements/${evenement.id}`,
    });

    this.logger.log(`Événement publié : ${evenement.titre}`);

    return this.trouver(id, { role: Role.ADMIN });
  }

  async archiver(id: string): Promise<Evenement> {
    await this.trouver(id, { role: Role.ADMIN });
    await this.evenements.update(id, { statut: StatutEvenement.ARCHIVE });
    return this.trouver(id, { role: Role.ADMIN });
  }

  /**
   * Supprime un événement.
   *
   * Refusé dès qu'une inscription existe : la suppression emporterait les
   * billets en cascade, y compris ceux déjà payés, sans trace. L'archivage est
   * la sortie prévue pour un événement qui a vécu.
   */
  async supprimer(id: string): Promise<void> {
    const evenement = await this.trouver(id, { role: Role.ADMIN });

    if (evenement.inscriptionsActuelles > 0) {
      throw new ForbiddenException(
        `Cet événement compte ${evenement.inscriptionsActuelles} inscription(s) : ` +
          'archivez-le plutôt que de le supprimer.',
      );
    }

    await this.evenements.delete(id);
  }

  // ──────────────────────  Réservé à la billetterie  ────────────────────

  /**
   * Réserve une place de façon atomique.
   *
   * Le compteur est incrémenté **dans la condition même** de la mise à jour :
   * `WHERE inscriptions_actuelles < capacite_max`. Lire puis écrire laisserait
   * deux inscriptions simultanées passer la vérification avant que l'une ait
   * écrit — c'est exactement ainsi qu'on vend deux fois la dernière place.
   *
   * Renvoie `false` si l'événement est complet.
   */
  async reserverUnePlace(id: string): Promise<boolean> {
    const resultat = await this.evenements
      .createQueryBuilder()
      .update(Evenement)
      .set({ inscriptionsActuelles: () => 'inscriptions_actuelles + 1' })
      .where(
        'id = :id AND (capacite_max = 0 OR inscriptions_actuelles < capacite_max)',
        { id },
      )
      .execute();

    return resultat.affected === 1;
  }

  /** Rend une place au compteur, sans jamais le faire passer sous zéro. */
  async libererUnePlace(id: string): Promise<void> {
    await this.evenements
      .createQueryBuilder()
      .update(Evenement)
      .set({ inscriptionsActuelles: () => 'inscriptions_actuelles - 1' })
      .where('id = :id AND inscriptions_actuelles > 0', { id })
      .execute();
  }

  /** Événements publiés à venir, pour les rappels et les tableaux de bord. */
  aVenir(): Promise<Evenement[]> {
    return this.evenements.find({
      where: {
        statut: StatutEvenement.PUBLIE,
        dateDebut: MoreThan(new Date()),
      },
      order: { dateDebut: 'ASC' },
    });
  }

  private verifierDates(debut: string | Date, fin?: string | Date): void {
    const d = new Date(debut);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('La date de début est invalide.');
    }
    if (fin) {
      const f = new Date(fin);
      if (Number.isNaN(f.getTime())) {
        throw new BadRequestException('La date de fin est invalide.');
      }
      if (f.getTime() <= d.getTime()) {
        throw new BadRequestException(
          'La date de fin doit être postérieure à la date de début.',
        );
      }
    }
  }
}
