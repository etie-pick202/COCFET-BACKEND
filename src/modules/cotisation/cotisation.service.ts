import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { GenerationService } from '../generation/generation.service';
import { User } from '../user/entities/user.entity';
import { Avancement, calculerAvancement } from './avancement';
import {
  CreerCotisationDto,
  DeclarerVersementDto,
  MettreAJourCotisationDto,
} from './dto/cotisation.dto';
import {
  CibleCotisation,
  Cotisation,
  StatutCotisation,
} from './entities/cotisation.entity';
import {
  ParticipationCotisation,
  StatutParticipation,
} from './entities/participation-cotisation.entity';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { VersementFinance } from './entities/versement-finance.entity';

@Injectable()
export class CotisationService {
  private readonly logger = new Logger(CotisationService.name);

  constructor(
    @InjectRepository(Cotisation)
    private readonly cotisations: Repository<Cotisation>,
    @InjectRepository(TrancheCotisation)
    private readonly tranches: Repository<TrancheCotisation>,
    @InjectRepository(ParticipationCotisation)
    private readonly participations: Repository<ParticipationCotisation>,
    @InjectRepository(VersementFinance)
    private readonly versements: Repository<VersementFinance>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly generationService: GenerationService,
  ) {}

  // ────────────────────────────  Cycle de vie  ──────────────────────────

  async creer(dto: CreerCotisationDto): Promise<Cotisation> {
    this.verifierTranches(dto.montantTotal, dto.tranches ?? []);

    const cotisation = await this.cotisations.save(
      this.cotisations.create({
        titre: dto.titre,
        description: dto.description ?? null,
        montantTotal: dto.montantTotal,
        cibles: dto.cibles,
        dateLimite: dto.dateLimite ? new Date(dto.dateLimite) : null,
        fractionnable: dto.fractionnable ?? false,
        accepteJustificatif: dto.accepteJustificatif ?? false,
        statut: StatutCotisation.BROUILLON,
      }),
    );

    await this.remplacerTranches(cotisation, dto.tranches ?? []);

    return this.trouver(cotisation.id);
  }

  /**
   * Retouche une cotisation **avant** son ouverture.
   *
   * Une fois ouverte, les montants sont figés dans les participations de
   * chacun : les modifier ici ne les changerait pas, et laisserait une
   * cotisation affichant un montant que personne ne doit réellement.
   */
  async mettreAJour(
    id: string,
    dto: MettreAJourCotisationDto,
  ): Promise<Cotisation> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut !== StatutCotisation.BROUILLON) {
      throw new ConflictException(
        'Cette cotisation est ouverte : ses montants sont figés dans les ' +
          'participations. Clôturez-la et relancez-en une autre.',
      );
    }

    const montantTotal = dto.montantTotal ?? cotisation.montantTotal;
    const tranches = dto.tranches;
    if (tranches) {
      this.verifierTranches(montantTotal, tranches);
    }

    await this.cotisations.update(id, {
      ...(dto.titre !== undefined ? { titre: dto.titre } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.montantTotal !== undefined ? { montantTotal } : {}),
      ...(dto.cibles !== undefined ? { cibles: dto.cibles } : {}),
      ...(dto.dateLimite !== undefined
        ? { dateLimite: dto.dateLimite ? new Date(dto.dateLimite) : null }
        : {}),
      ...(dto.fractionnable !== undefined
        ? { fractionnable: dto.fractionnable }
        : {}),
      ...(dto.accepteJustificatif !== undefined
        ? { accepteJustificatif: dto.accepteJustificatif }
        : {}),
    });

    if (tranches) {
      await this.remplacerTranches(cotisation, tranches);
    }

    return this.trouver(id);
  }

  /**
   * Ouvre la cotisation et fige ce que chacun doit.
   *
   * C'est **ce geste** qui crée les participations et y recopie le montant.
   * Le calculer à la lecture ferait qu'une révision du montant rendrait tout
   * le monde rétroactivement en retard, y compris ceux qui avaient soldé.
   *
   * Idempotent sur les personnes déjà inscrites : rouvrir ne duplique rien et
   * n'écrase aucun solde.
   */
  async ouvrir(id: string): Promise<Cotisation> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut === StatutCotisation.CLOSE) {
      throw new ConflictException('Cette cotisation est close.');
    }
    if (cotisation.cibles.length === 0) {
      throw new BadRequestException(
        'Aucune population visée : personne ne serait appelé à verser.',
      );
    }

    const concernes = await this.populationVisee(cotisation.cibles);

    if (concernes.length > 0) {
      const dejaInscrits = await this.participations.find({
        where: {
          cotisation: { id },
          user: { id: In(concernes.map((personne) => personne.id)) },
        },
        relations: { user: true },
      });
      const connus = new Set(dejaInscrits.map((p) => p.user.id));

      const nouvelles = concernes
        .filter((personne) => !connus.has(personne.id))
        .map((personne) =>
          this.participations.create({
            cotisation,
            user: personne,
            montantDu: cotisation.montantTotal,
            montantRegle: 0,
          }),
        );

      if (nouvelles.length > 0) {
        await this.participations.save(nouvelles);
      }
    }

    await this.cotisations.update(id, { statut: StatutCotisation.OUVERTE });

    this.logger.log(
      `Cotisation « ${cotisation.titre} » ouverte : ${concernes.length} personne(s) concernée(s).`,
    );

    return this.trouver(id);
  }

  async clore(id: string): Promise<Cotisation> {
    await this.trouver(id);
    await this.cotisations.update(id, { statut: StatutCotisation.CLOSE });
    return this.trouver(id);
  }

  async supprimer(id: string): Promise<void> {
    const cotisation = await this.trouver(id);

    if (cotisation.statut !== StatutCotisation.BROUILLON) {
      // Effacer une cotisation ouverte emporterait les versements déjà
      // reconnus, et l'argent encaissé n'aurait plus de contrepartie.
      throw new ConflictException(
        'Seule une cotisation en brouillon peut être supprimée.',
      );
    }

    await this.cotisations.delete(id);
  }

  // ─────────────────────────────  Consultation  ─────────────────────────

  lister(): Promise<Cotisation[]> {
    return this.cotisations.find({
      relations: { tranches: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** Cotisations auxquelles une personne est appelée, avec son avancement. */
  async mesCotisations(
    userId: string,
  ): Promise<{ cotisation: Cotisation; avancement: Avancement }[]> {
    const participations = await this.participations.find({
      where: { user: { id: userId } },
      relations: { cotisation: { tranches: true } },
      order: { createdAt: 'DESC' },
    });

    return participations.map((participation) => ({
      cotisation: participation.cotisation,
      avancement: calculerAvancement(
        participation.montantDu,
        participation.montantRegle,
        participation.cotisation.tranches ?? [],
      ),
    }));
  }

  async trouver(id: string): Promise<Cotisation> {
    const cotisation = await this.cotisations.findOne({
      where: { id },
      relations: { tranches: true },
    });

    if (!cotisation) {
      throw new NotFoundException("Cette cotisation n'existe pas.");
    }

    return cotisation;
  }

  /** Vue complète, réservée aux finances : qui a versé quoi, qui est en retard. */
  async participationsDe(cotisationId: string): Promise<
    {
      participation: ParticipationCotisation;
      avancement: Avancement;
    }[]
  > {
    const cotisation = await this.trouver(cotisationId);

    const participations = await this.participations.find({
      where: { cotisation: { id: cotisationId } },
      relations: { user: true },
    });

    return participations.map((participation) => ({
      participation,
      avancement: calculerAvancement(
        participation.montantDu,
        participation.montantRegle,
        cotisation.tranches ?? [],
      ),
    }));
  }

  // ──────────────────────────────  Règlement  ───────────────────────────

  /**
   * Porte un versement reconnu au solde d'une participation.
   *
   * Appelée par l'aiguillage des paiements : un règlement en ligne et la
   * validation d'une preuve remise en main propre passent par ici, sans se
   * connaître.
   *
   * L'incrément est fait **en base** et non lu puis réécrit : deux règlements
   * simultanés — un paiement en ligne pendant qu'un justificatif est validé —
   * se liraient tous deux avant d'écrire, et le second écraserait le premier.
   */
  async enregistrerReglement(
    participationId: string,
    montant: number,
  ): Promise<void> {
    const participation = await this.participations.findOne({
      where: { id: participationId },
    });

    if (!participation) {
      this.logger.warn(
        `Règlement reçu pour une participation inconnue : ${participationId}`,
      );
      return;
    }

    await this.participations.increment(
      { id: participationId },
      'montantRegle',
      montant,
    );

    const apres = await this.participations.findOneOrFail({
      where: { id: participationId },
    });

    if (
      apres.montantRegle >= apres.montantDu &&
      apres.statut === StatutParticipation.EN_COURS
    ) {
      await this.participations.update(participationId, {
        statut: StatutParticipation.SOLDEE,
      });
    }
  }

  // ───────────────────────────────  Encaisse  ───────────────────────────

  /**
   * Enregistre la remise au bureau de ce qu'un membre détenait.
   *
   * Déclaratif : la plateforme tient un registre, elle ne remplace ni la
   * confiance ni les comptes du bureau.
   */
  async declarerVersement(
    membre: User,
    dto: DeclarerVersementDto,
  ): Promise<VersementFinance> {
    if (dto.montant <= 0) {
      throw new BadRequestException('Le montant remis doit être positif.');
    }

    const recuPar = dto.recuParId
      ? await this.users.findOne({ where: { id: dto.recuParId } })
      : null;

    return this.versements.save(
      this.versements.create({
        membre,
        montant: dto.montant,
        recuPar,
        note: dto.note ?? null,
      }),
    );
  }

  listerVersements(): Promise<VersementFinance[]> {
    return this.versements.find({
      relations: { membre: true, recuPar: true },
      order: { createdAt: 'DESC' },
    });
  }

  // ─────────────────────────────  Interne  ──────────────────────────────

  /**
   * Refuse un échéancier qui ne totalise pas le montant dû.
   *
   * Une cotisation dont les tranches ne couvrent pas la somme est une faute de
   * saisie, jamais une configuration : la personne verserait la totalité des
   * tranches sans être à jour, ou serait déclarée soldée en ayant moins versé.
   */
  private verifierTranches(
    montantTotal: number,
    tranches: { montant: number; ordre: number }[],
  ): void {
    if (tranches.length === 0) {
      return;
    }

    const somme = tranches.reduce((total, t) => total + t.montant, 0);
    if (somme !== montantTotal) {
      throw new BadRequestException(
        `Les tranches totalisent ${somme} FCFA pour un montant dû de ${montantTotal} FCFA.`,
      );
    }

    const ordres = new Set(tranches.map((t) => t.ordre));
    if (ordres.size !== tranches.length) {
      // Deux tranches de même rang rendraient leur consommation indéterminée.
      throw new BadRequestException(
        'Deux tranches portent le même ordre : leur enchaînement serait indéterminé.',
      );
    }
  }

  private async remplacerTranches(
    cotisation: Cotisation,
    tranches: CreerCotisationDto['tranches'],
  ): Promise<void> {
    await this.tranches.delete({ cotisation: { id: cotisation.id } });

    if (!tranches?.length) {
      return;
    }

    await this.tranches.save(
      tranches.map((tranche) =>
        this.tranches.create({
          cotisation,
          ordre: tranche.ordre,
          libelle: tranche.libelle,
          montant: tranche.montant,
          dateLimite: new Date(tranche.dateLimite),
        }),
      ),
    );
  }

  /**
   * Traduit les populations visées en personnes réelles.
   *
   * « Finissant » et « alumni » ne sont pas des rôles mais des statuts déduits
   * de la promotion et du mandat en cours : les confondre avec `STUDENT`
   * ferait cotiser les mauvaises personnes.
   */
  private async populationVisee(cibles: CibleCotisation[]): Promise<User[]> {
    const generation = await this.generationService.trouverActive();
    const requete = this.users
      .createQueryBuilder('u')
      .where('u.is_active = true');

    const conditions: string[] = [];
    const parametres: Record<string, unknown> = {};

    if (cibles.includes(CibleCotisation.FINISSANT)) {
      conditions.push('u.is_finissant = true');
    }
    if (cibles.includes(CibleCotisation.ETUDIANT)) {
      conditions.push('u.role = :etudiant');
      parametres.etudiant = Role.STUDENT;
    }
    if (cibles.includes(CibleCotisation.VISITEUR)) {
      conditions.push('u.role = :visiteur');
      parametres.visiteur = Role.VISITOR;
    }
    if (cibles.includes(CibleCotisation.ADMIN)) {
      conditions.push('u.role = :admin');
      parametres.admin = Role.ADMIN;
    }
    if (cibles.includes(CibleCotisation.ALUMNI) && generation) {
      // Alumni : a été étudiant, et sa promotion est derrière le mandat en
      // cours. Sans génération active, la notion n'a pas de repère — la cible
      // est alors ignorée plutôt que devinée.
      conditions.push('(u.promotion IS NOT NULL AND u.promotion < :annee)');
      parametres.annee = generation.annee;
    }

    if (conditions.length === 0) {
      return [];
    }

    return requete
      .andWhere(`(${conditions.join(' OR ')})`, parametres)
      .getMany();
  }
}
