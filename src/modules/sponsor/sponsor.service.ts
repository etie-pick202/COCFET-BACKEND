import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  paginer,
  PaginationDto,
  ResultatPagine,
  triAutorise,
} from '../../common/pagination';
import { Role } from '../../common/enums/role.enum';
import { normaliserEmail } from '../../common/identite/identite-campus';
import { TypeJeton } from '../auth/entities/jeton-auth.entity';
import { JetonService } from '../auth/jeton.service';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { InviterSponsorDto } from './dto/inviter-sponsor.dto';
import { PalierSponsor } from './entities/palier-sponsor.entity';
import { Sponsor } from './entities/sponsor.entity';

const TRIS_AUTORISES = ['createdAt', 'nom'] as const;

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);

  constructor(
    @InjectRepository(Sponsor) private readonly sponsors: Repository<Sponsor>,
    @InjectRepository(PalierSponsor)
    private readonly paliers: Repository<PalierSponsor>,
    private readonly userService: UserService,
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

  async lister(pagination: PaginationDto): Promise<ResultatPagine<Sponsor>> {
    const tri = triAutorise(pagination.tri, TRIS_AUTORISES, 'createdAt');

    return paginer(
      await this.sponsors.findAndCount({
        relations: { palier: true },
        order: { [tri]: pagination.ordre },
        skip: pagination.sauter,
        take: pagination.limite,
      }),
      pagination,
    );
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
