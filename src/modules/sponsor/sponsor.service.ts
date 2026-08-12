import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { Role } from '../../common/enums/role.enum';
import { normaliserEmail } from '../../common/identite/identite-campus';
import { TypeJeton } from '../auth/entities/jeton-auth.entity';
import { JetonService } from '../auth/jeton.service';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { InviterSponsorDto } from './dto/inviter-sponsor.dto';
import {
  ChangerPalierDto,
  CreerPalierDto,
  FiltreSponsorDto,
  MettreAJourPalierDto,
  MettreAJourSponsorDto,
  SponsorPublic,
} from './dto/sponsor.dto';
import { PalierSponsor } from './entities/palier-sponsor.entity';
import { Sponsor } from './entities/sponsor.entity';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';

const TRIS_AUTORISES = ['createdAt', 'nom'] as const;

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);

  constructor(
    @InjectRepository(Sponsor) private readonly sponsors: Repository<Sponsor>,
    @InjectRepository(PalierSponsor)
    private readonly paliers: Repository<PalierSponsor>,
    private readonly userService: UserService,
    private readonly nettoyage: NettoyageFichiers,
    private readonly jetonService: JetonService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crée un partenaire et lui envoie une invitation.
   *
   * Réservé à l'administration : un sponsor ne s'inscrit jamais de lui-même,
   * le partenariat se négocie hors de la plateforme. Le compte est donc créé
   * **sans mot de passe** — le partenaire choisira le sien en suivant le lien.
   * Le bureau n'en génère ni n'en transmet aucun : un mot de passe envoyé par
   * mail est lisible par quiconque accède à la boîte, et reste souvent
   * inchangé.
   */
  async inviter(dto: InviterSponsorDto): Promise<Sponsor> {
    const email = normaliserEmail(dto.email);

    const existant = await this.userService.findByEmail(email);
    if (existant) {
      // Rattacher un sponsor à un compte existant donnerait le rôle SPONSOR à
      // un utilisateur déjà inscrit — potentiellement un étudiant — et lui
      // ouvrirait l'annuaire. L'administration doit trancher explicitement.
      throw new ConflictException(
        'Un compte utilise déjà cette adresse. Utilisez une autre adresse de contact.',
      );
    }

    const palier = dto.palierId ? await this.trouverPalier(dto.palierId) : null;

    const user = await this.userService.create({
      email,
      firstName: dto.nom,
      lastName: 'Partenaire',
      role: Role.SPONSOR,
      // Ni mot de passe ni vérification : les deux viendront du clic sur
      // l'invitation. En attendant, le compte ne peut pas se connecter.
      passwordHash: null,
      emailVerifieLe: null,
    });

    const sponsor = await this.sponsors.save(
      this.sponsors.create({
        user,
        nom: dto.nom,
        email,
        secteur: dto.secteur ?? null,
        description: dto.description ?? null,
        siteWeb: dto.siteWeb ?? null,
        palier,
        stats: { vuesPage: 0, profilsConsultes: 0, cvTelecharges: 0 },
      }),
    );

    await this.envoyerInvitation(sponsor);

    return sponsor;
  }

  /**
   * Réémet une invitation. Le jeton précédent est révoqué par
   * {@link JetonService.emettre} : un lien communiqué par erreur cesse d'être
   * utilisable dès qu'un nouveau part.
   */
  async reinviter(sponsorId: string): Promise<void> {
    const sponsor = await this.sponsors.findOne({
      where: { id: sponsorId },
      relations: { user: true },
    });

    if (!sponsor) {
      throw new NotFoundException("Ce partenaire n'existe pas.");
    }
    if (!sponsor.user) {
      throw new ConflictException(
        'Ce partenaire n’a aucun compte de connexion associé.',
      );
    }
    if (sponsor.user.emailVerifieLe) {
      throw new ConflictException('Cet accès partenaire est déjà activé.');
    }

    await this.envoyerInvitation(sponsor);
  }

  async lister(filtre: FiltreSponsorDto): Promise<ResultatPagine<Sponsor>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    return paginer(
      await this.sponsors.findAndCount({
        where: filtre.palierId ? { palier: { id: filtre.palierId } } : {},
        relations: { palier: true, user: true },
        order: { [tri]: filtre.ordre },
        skip: filtre.sauter,
        take: filtre.limite,
      }),
      filtre,
    );
  }

  // ─────────────────────────────  Consultation  ─────────────────────────

  /**
   * Vitrine publique des partenaires.
   *
   * Ni adresse email, ni quotas, ni statistiques : ces données servent la
   * relation commerciale, pas l'affichage. Les exposer sur une page ouverte
   * livrerait les contacts de tous les partenaires aux robots collecteurs.
   */
  async listerPublic(): Promise<SponsorPublic[]> {
    // Tri confie a la base : les paliers les plus eleves d'abord, puis l'ordre
    // alphabetique. Sans second critere, deux partenaires du meme palier
    // changeraient de place d'un appel a l'autre. NULLS LAST place les
    // partenaires sans palier en fin de liste plutot qu'en tete.
    const sponsors = await this.sponsors
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.palier', 'palier')
      .orderBy('palier.ordre', 'ASC', 'NULLS LAST')
      .addOrderBy('s.nom', 'ASC')
      .getMany();

    return sponsors.map((s) => ({
      id: s.id,
      nom: s.nom,
      logo: s.logo,
      description: s.description,
      siteWeb: s.siteWeb,
      secteur: s.secteur,
      palier: s.palier
        ? {
            nom: s.palier.nom,
            ordre: s.palier.ordre,
            tailleLogo: s.palier.tailleLogo,
          }
        : null,
    }));
  }

  async trouver(id: string): Promise<Sponsor> {
    const sponsor = await this.sponsors.findOne({
      where: { id },
      relations: { palier: true, user: true },
    });

    if (!sponsor) {
      throw new NotFoundException("Ce partenaire n'existe pas.");
    }

    return sponsor;
  }

  /** Fiche du partenaire connecte, retrouvee depuis son compte. */
  async trouverParUtilisateur(userId: string): Promise<Sponsor> {
    const sponsor = await this.sponsors.findOne({
      where: { user: { id: userId } },
      relations: { palier: true },
    });

    if (!sponsor) {
      throw new NotFoundException(
        "Aucun partenaire n'est associé à ce compte.",
      );
    }

    return sponsor;
  }

  // ──────────────────────────────  Ecriture  ────────────────────────────

  /**
   * Met a jour la fiche.
   *
   * `userId` est fourni quand c'est le partenaire lui-meme qui modifie : la
   * verification d'appartenance fait alors partie de l'operation, plutot que
   * d'etre laissee au controleur. Le palier n'est jamais modifiable ici — il
   * conditionne l'acces a l'annuaire, et un partenaire pourrait sinon
   * s'accorder les droits du palier superieur.
   */
  async mettreAJour(
    id: string,
    dto: MettreAJourSponsorDto,
    userId?: string,
  ): Promise<Sponsor> {
    const sponsor = await this.trouver(id);

    if (userId && sponsor.user?.id !== userId) {
      throw new ForbiddenException(
        'Vous ne pouvez modifier que votre propre fiche.',
      );
    }

    await this.sponsors.update(id, dto);
    await this.nettoyage.remplacer(sponsor.logo, dto.logo);

    return this.trouver(id);
  }

  async changerPalier(id: string, dto: ChangerPalierDto): Promise<Sponsor> {
    await this.trouver(id);

    const palier = dto.palierId ? await this.trouverPalier(dto.palierId) : null;

    await this.sponsors.update(id, { palier });

    return this.trouver(id);
  }

  /**
   * Supprime un partenaire et son compte de connexion.
   *
   * Le compte part avec la fiche : le laisser derriere creerait un
   * utilisateur au role SPONSOR sans partenaire associe, capable de se
   * connecter sans que rien n'explique pourquoi.
   */
  async supprimer(id: string): Promise<void> {
    const sponsor = await this.trouver(id);
    const compte = sponsor.user;

    await this.sponsors.delete(id);

    if (compte) {
      await this.userService.supprimer(compte.id);
    }

    // La fiche partie, son logo n'habille plus aucune page partenaire.
    await this.nettoyage.retirer(sponsor.logo);
  }

  // ───────────────────────────────  Paliers  ────────────────────────────

  listerPaliers(): Promise<PalierSponsor[]> {
    return this.paliers.find({ order: { ordre: 'ASC' } });
  }

  creerPalier(dto: CreerPalierDto): Promise<PalierSponsor> {
    return this.paliers.save(this.paliers.create(dto));
  }

  async mettreAJourPalier(
    id: string,
    dto: MettreAJourPalierDto,
  ): Promise<PalierSponsor> {
    await this.trouverPalier(id);
    await this.paliers.update(id, dto);
    return this.trouverPalier(id);
  }

  /**
   * Supprime un palier.
   *
   * Refuse tant qu'un partenaire s'y rattache : la relation est en SET NULL,
   * donc la suppression retirerait silencieusement leurs droits d'annuaire
   * sans que personne ne s'en apercoive avant une reclamation.
   */
  async supprimerPalier(id: string): Promise<void> {
    await this.trouverPalier(id);

    const rattaches = await this.sponsors.countBy({ palier: { id } });
    if (rattaches > 0) {
      throw new ConflictException(
        `${rattaches} partenaire(s) utilisent ce palier : reaffectez-les d'abord.`,
      );
    }

    await this.paliers.delete(id);
  }

  private async trouverPalier(id: string): Promise<PalierSponsor> {
    const palier = await this.paliers.findOne({ where: { id } });
    if (!palier) {
      throw new NotFoundException("Ce palier de sponsor n'existe pas.");
    }
    return palier;
  }

  private async envoyerInvitation(sponsor: Sponsor): Promise<void> {
    if (!sponsor.user) {
      return;
    }

    const jeton = await this.jetonService.emettre(
      sponsor.user,
      TypeJeton.INVITATION_SPONSOR,
    );

    const base = this.config
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')[0];

    await this.mailService.envoyerInvitationSponsor(
      sponsor.email,
      sponsor.nom,
      `${base}/invitation?jeton=${encodeURIComponent(jeton)}`,
    );

    this.logger.log(`Invitation partenaire envoyée à ${sponsor.nom}.`);
  }
}
