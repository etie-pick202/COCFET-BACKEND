import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import {
  JournalActivite,
  TypeActivite,
} from '../activite/entities/journal-activite.entity';
import type { Stockage } from '../file/ports/stockage';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { STOCKAGE } from '../file/ports/stockage';
import { Sponsor } from '../sponsor/entities/sponsor.entity';
import { User } from '../user/entities/user.entity';
import {
  ChangerVisibiliteDto,
  MettreAJourProfilFinissantDto,
  ProfilDetail,
  ProfilResume,
  QuotasSponsor,
  RechercheAnnuaireDto,
} from './dto/annuaire.dto';
import { ProfilFinissant } from './entities/profil-finissant.entity';

const TRIS_AUTORISES = ['createdAt', 'filiere'] as const;

/** Durée d'une URL de CV. Assez pour ouvrir le fichier, pas pour le diffuser. */
const EXPIRATION_CV_SECONDES = 300;

/** Ce qu'on retient d'un demandeur pour décider de son accès. */
export interface Demandeur {
  id: string;
  role: Role;
}

@Injectable()
export class AnnuaireService {
  private readonly logger = new Logger(AnnuaireService.name);

  constructor(
    @InjectRepository(ProfilFinissant)
    private readonly profils: Repository<ProfilFinissant>,
    @InjectRepository(Sponsor)
    private readonly sponsors: Repository<Sponsor>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(JournalActivite)
    private readonly journal: Repository<JournalActivite>,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
    private readonly nettoyage: NettoyageFichiers,
  ) {}

  // ────────────────────────────  Son profil  ────────────────────────────

  /**
   * Crée ou met à jour sa fiche.
   *
   * Réservé aux comptes dont `isFinissant` vaut vrai : l'annuaire est celui
   * des finissants du mandat en cours, pas un profil professionnel ouvert à
   * tous. Le statut est calculé à la bascule de génération, jamais déclaré.
   */
  async enregistrerSonProfil(
    userId: string,
    dto: MettreAJourProfilFinissantDto,
  ): Promise<ProfilFinissant> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("Ce compte n'existe pas.");
    }
    if (!user.isFinissant) {
      throw new ForbiddenException(
        "L'annuaire est réservé aux finissants de la génération en cours.",
      );
    }

    const existant = await this.profils.findOne({
      where: { user: { id: userId } },
    });

    if (!existant) {
      if (!dto.filiere) {
        throw new BadRequestException(
          'La filière est requise pour créer votre fiche.',
        );
      }

      return this.profils.save(
        this.profils.create({
          user,
          filiere: dto.filiere,
          competences: dto.competences ?? [],
          bio: dto.bio ?? null,
          linkedinUrl: dto.linkedinUrl ?? null,
          githubUrl: dto.githubUrl ?? null,
          portfolioUrl: dto.portfolioUrl ?? null,
          photo: dto.photo ?? null,
          cvUrl: dto.cvUrl ?? null,
          isVisible: true,
        }),
      );
    }

    // Remplacer une pièce supprime la précédente : sans cela, chaque
    // remplacement laisserait un objet orphelin, facturé et inaccessible.
    await this.nettoyage.remplacer(existant.photo, dto.photo);
    await this.nettoyage.remplacer(existant.cvUrl, dto.cvUrl);

    await this.profils.update(existant.id, {
      ...(dto.filiere !== undefined ? { filiere: dto.filiere } : {}),
      ...(dto.competences !== undefined
        ? { competences: dto.competences }
        : {}),
      ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      ...(dto.linkedinUrl !== undefined
        ? { linkedinUrl: dto.linkedinUrl }
        : {}),
      ...(dto.githubUrl !== undefined ? { githubUrl: dto.githubUrl } : {}),
      ...(dto.portfolioUrl !== undefined
        ? { portfolioUrl: dto.portfolioUrl }
        : {}),
      ...(dto.photo !== undefined ? { photo: dto.photo } : {}),
      ...(dto.cvUrl !== undefined ? { cvUrl: dto.cvUrl } : {}),
    });

    return this.profils.findOneOrFail({ where: { id: existant.id } });
  }

  async sonProfil(userId: string): Promise<ProfilFinissant> {
    const profil = await this.profils.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
    });

    if (!profil) {
      throw new NotFoundException("Vous n'avez pas encore de fiche.");
    }

    return profil;
  }

  /**
   * Règle sa présence dans l'annuaire.
   *
   * Endpoint distinct, et **sans équivalent côté administration** : l'annuaire
   * expose des données personnelles à des entreprises, et le consentement de
   * la personne ne se délègue pas au bureau.
   */
  async changerVisibilite(
    userId: string,
    dto: ChangerVisibiliteDto,
  ): Promise<ProfilFinissant> {
    const profil = await this.sonProfil(userId);

    await this.profils.update(profil.id, { isVisible: dto.isVisible });

    return this.sonProfil(userId);
  }

  async supprimerSonProfil(userId: string): Promise<void> {
    const profil = await this.sonProfil(userId);

    await this.nettoyage.remplacer(profil.photo, null);
    await this.nettoyage.remplacer(profil.cvUrl, null);
    await this.profils.delete(profil.id);
  }

  // ─────────────────────────────  Consultation  ─────────────────────────

  /**
   * Recherche dans l'annuaire.
   *
   * Ne consomme **aucun quota** : la liste ne livre ni CV, ni liens externes,
   * ni biographie. Une liste complète rendrait le quota décoratif, puisqu'il
   * suffirait d'en parcourir les pages.
   */
  async rechercher(
    filtre: RechercheAnnuaireDto,
    demandeur: Demandeur,
  ): Promise<ResultatPagine<ProfilResume>> {
    await this.verifierAcces(demandeur);

    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');
    const requete = this.profils
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.user', 'u')
      // Un profil masqué n'apparaît dans aucune recherche : c'est la garantie
      // que l'étudiant a réellement la main sur sa présence.
      .where('p.is_visible = true')
      .andWhere('u.is_active = true');

    if (filtre.filiere) {
      requete.andWhere('p.filiere ILIKE :filiere', {
        filiere: `%${filtre.filiere}%`,
      });
    }
    if (filtre.promotion !== undefined) {
      requete.andWhere('u.promotion = :promotion', {
        promotion: filtre.promotion,
      });
    }
    if (filtre.competences?.length) {
      // Contenance jsonb : le profil doit posséder **toutes** les compétences
      // demandées. Un « ou » ramènerait tout le monde dès la première.
      requete.andWhere('p.competences @> :competences::jsonb', {
        competences: JSON.stringify(filtre.competences),
      });
    }
    if (filtre.recherche) {
      const motif = `%${filtre.recherche}%`;
      requete.andWhere(
        new Brackets((q) =>
          q
            .where('u.first_name ILIKE :motif', { motif })
            .orWhere('u.last_name ILIKE :motif', { motif })
            .orWhere('p.bio ILIKE :motif', { motif }),
        ),
      );
    }

    requete
      .orderBy(`p.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    const [profils, total] = await requete.getManyAndCount();

    return paginer([profils.map((p) => this.versResume(p)), total], filtre);
  }

  /**
   * Consulte une fiche complète.
   *
   * **Décompte le quota de consultations** du sponsor : c'est ici que la
   * donnée personnelle est réellement livrée. Un administrateur consulte sans
   * décompte — il ne paie pas d'accréditation.
   */
  async consulter(id: string, demandeur: Demandeur): Promise<ProfilDetail> {
    const sponsor = await this.verifierAcces(demandeur);

    const profil = await this.profils.findOne({
      where: { id, isVisible: true },
      relations: { user: true },
    });

    if (!profil?.user.isActive) {
      // Même réponse qu'un identifiant inconnu : distinguer les deux
      // révélerait l'existence d'une fiche masquée.
      throw new NotFoundException("Ce profil n'existe pas.");
    }

    if (sponsor) {
      await this.consommerQuota(sponsor, 'profilsConsultes');
      await this.tracer(
        demandeur.id,
        `Consultation du profil de ${profil.user.firstName} ${profil.user.lastName}`,
        { profilId: profil.id, sponsorId: sponsor.id },
      );
    }

    return {
      ...this.versResume(profil),
      bio: profil.bio,
      linkedinUrl: profil.linkedinUrl,
      githubUrl: profil.githubUrl,
      portfolioUrl: profil.portfolioUrl,
      aUnCv: profil.cvUrl !== null,
    };
  }

  /**
   * Délivre une URL de téléchargement du CV.
   *
   * L'URL **expire en cinq minutes** : un lien permanent circulerait bien
   * au-delà du sponsor accrédité, et le CV est la pièce la plus sensible de
   * l'annuaire. Le quota est décompté avant la délivrance, et le
   * téléchargement tracé.
   */
  async telechargerCv(
    id: string,
    demandeur: Demandeur,
  ): Promise<{ url: string; expireDans: number }> {
    const sponsor = await this.verifierAcces(demandeur);

    const profil = await this.profils.findOne({
      where: { id, isVisible: true },
      relations: { user: true },
    });

    if (!profil?.cvUrl || !profil.user.isActive) {
      throw new NotFoundException('Aucun CV disponible pour ce profil.');
    }

    if (sponsor) {
      await this.consommerQuota(sponsor, 'cvTelecharges');
      await this.tracer(
        demandeur.id,
        `Téléchargement du CV de ${profil.user.firstName} ${profil.user.lastName}`,
        { profilId: profil.id, sponsorId: sponsor.id },
      );
    }

    return {
      url: await this.stockage.urlSignee(profil.cvUrl, EXPIRATION_CV_SECONDES),
      expireDans: EXPIRATION_CV_SECONDES,
    };
  }

  /** État des quotas du sponsor connecté. */
  async mesQuotas(userId: string): Promise<QuotasSponsor> {
    const sponsor = await this.sponsorDe(userId);

    if (!sponsor) {
      throw new NotFoundException(
        "Aucun partenaire n'est associé à ce compte.",
      );
    }

    return {
      consultationsProfils: {
        utilise: sponsor.stats?.profilsConsultes ?? 0,
        plafond: this.plafond(sponsor, 'profilsConsultes'),
      },
      telechargementsCv: {
        utilise: sponsor.stats?.cvTelecharges ?? 0,
        plafond: this.plafond(sponsor, 'cvTelecharges'),
      },
    };
  }

  /** Remet les compteurs à zéro — nouvelle période de facturation. */
  async reinitialiserQuotas(sponsorId: string): Promise<void> {
    const sponsor = await this.sponsors.findOne({ where: { id: sponsorId } });

    if (!sponsor) {
      throw new NotFoundException("Ce partenaire n'existe pas.");
    }

    await this.sponsors.update(sponsorId, {
      stats: { ...sponsor.stats, profilsConsultes: 0, cvTelecharges: 0 },
    });

    this.logger.log(`Quotas remis à zéro pour le partenaire ${sponsor.nom}.`);
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  /**
   * Décide qui entre dans l'annuaire.
   *
   * C'est le point le plus sensible du module : une erreur ici expose les
   * données personnelles et les CV d'une promotion entière à des tiers non
   * autorisés. Renvoie le sponsor lorsque c'en est un — les quotas ne
   * s'appliquent qu'à lui.
   */
  private async verifierAcces(demandeur: Demandeur): Promise<Sponsor | null> {
    if (demandeur.role === Role.ADMIN) {
      return null;
    }

    if (demandeur.role !== Role.SPONSOR) {
      throw new ForbiddenException(
        "L'annuaire est réservé aux partenaires accrédités.",
      );
    }

    const sponsor = await this.sponsorDe(demandeur.id);

    if (!sponsor) {
      throw new ForbiddenException(
        "Aucun partenaire n'est associé à ce compte.",
      );
    }
    if (!sponsor.palier) {
      // Un sponsor sans palier n'a négocié aucune accréditation : le refus est
      // le comportement sûr, l'inverse ouvrirait l'annuaire par omission.
      throw new ForbiddenException(
        "Votre partenariat n'inclut pas l'accès à l'annuaire.",
      );
    }
    if (!sponsor.palier.accesAnnuaire) {
      throw new ForbiddenException(
        `Le palier « ${sponsor.palier.nom} » n'inclut pas l'accès à l'annuaire.`,
      );
    }

    return sponsor;
  }

  private sponsorDe(userId: string): Promise<Sponsor | null> {
    return this.sponsors.findOne({
      where: { user: { id: userId } },
      relations: { palier: true },
    });
  }

  /** Quota effectif : le réglage dérogatoire prime sur celui du palier. */
  private plafond(
    sponsor: Sponsor,
    compteur: 'profilsConsultes' | 'cvTelecharges',
  ): number {
    const personnalise =
      compteur === 'profilsConsultes'
        ? sponsor.quotasPersonnalises?.consultationsProfils
        : sponsor.quotasPersonnalises?.telechargementsCv;

    // Un quota derogatoire a zero est une valeur legitime — « ce partenaire
    // n'a pas droit a l'annuaire » — d'ou la comparaison a undefined et non
    // une simple verite.
    if (personnalise !== undefined) {
      return personnalise;
    }

    return compteur === 'profilsConsultes'
      ? (sponsor.palier?.maxConsultationsProfils ?? 0)
      : (sponsor.palier?.maxTelechargementsCv ?? 0);
  }

  /**
   * Décompte une unité de quota.
   *
   * L'incrément est **conditionné au plafond dans la requête elle-même** :
   * lire puis écrire laisserait deux consultations simultanées franchir la
   * dernière unité, et le quota vendu au partenaire ne serait pas celui
   * appliqué.
   */
  private async consommerQuota(
    sponsor: Sponsor,
    compteur: 'profilsConsultes' | 'cvTelecharges',
  ): Promise<void> {
    const plafond = this.plafond(sponsor, compteur);

    if (plafond <= 0) {
      throw new ForbiddenException(
        compteur === 'profilsConsultes'
          ? "Votre palier n'autorise aucune consultation de profil."
          : "Votre palier n'autorise aucun téléchargement de CV.",
      );
    }

    const resultat = await this.sponsors
      .createQueryBuilder()
      .update(Sponsor)
      .set({
        stats: () =>
          `jsonb_set(COALESCE(stats, '{}'::jsonb), '{${compteur}}', ` +
          `to_jsonb(COALESCE((stats->>'${compteur}')::int, 0) + 1))`,
      })
      .where(
        `id = :id AND COALESCE((stats->>'${compteur}')::int, 0) < :plafond`,
        { id: sponsor.id, plafond },
      )
      .execute();

    if (resultat.affected !== 1) {
      throw new ForbiddenException(
        compteur === 'profilsConsultes'
          ? `Quota de consultations épuisé (${plafond}).`
          : `Quota de téléchargements de CV épuisé (${plafond}).`,
      );
    }
  }

  private versResume(profil: ProfilFinissant): ProfilResume {
    return {
      id: profil.id,
      prenom: profil.user.firstName,
      nom: profil.user.lastName,
      photo: profil.photo,
      filiere: profil.filiere,
      promotion: profil.user.promotion,
      competences: profil.competences ?? [],
    };
  }

  private async tracer(
    userId: string,
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.journal.save(
      this.journal.create({
        type: TypeActivite.UTILISATEUR,
        message,
        user: { id: userId } as User,
        metadata,
      }),
    );
  }
}
