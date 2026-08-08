import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Brackets, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import {
  ChangerMotDePasseDto,
  FiltreUtilisateurDto,
  MettreAJourProfilDto,
  MettreAJourUtilisateurDto,
} from './dto/user.dto';
import { User } from './entities/user.entity';

const TRIS_AUTORISES = ['createdAt', 'lastName', 'promotion', 'role'] as const;

/** Même coût que celui de l'inscription : les deux empreintes coexistent. */
const TOURS_BCRYPT = 12;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** L'email est supposé déjà normalisé par l'appelant. */
  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  /**
   * Lecture par adresse **avec l'empreinte du mot de passe**.
   *
   * Réservée à la connexion, qui est le seul endroit ayant besoin de comparer.
   * Séparée de `findByEmail` pour que le cas courant reste sans empreinte : un
   * appelant qui n'en a pas besoin ne peut pas la laisser fuir par mégarde.
   */
  findByEmailPourConnexion(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  /**
   * Lecture par identifiant **avec l'empreinte du refresh token**.
   *
   * Réservée à la rotation des jetons, seul endroit qui compare l'empreinte
   * stockée à celle du jeton présenté.
   */
  findByIdPourRafraichissement(id: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.refreshTokenHash')
      .where('u.id = :id', { id })
      .getOne();
  }

  create(data: Partial<User>): Promise<User> {
    return this.users.save(this.users.create(data));
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    await this.users.update(id, data);
    // Relu par `trouverOuEchouer` et non `findById` : le résultat part vers
    // `exposerUtilisateur`, qui a besoin de savoir si un mot de passe existe.
    return this.trouverOuEchouer(id);
  }

  async supprimer(id: string): Promise<void> {
    await this.users.delete(id);
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    await this.users.update(id, { refreshTokenHash: hash });
  }

  // ────────────────────────────  Son profil  ────────────────────────────

  /**
   * Charge un compte destiné à être exposé ou à confirmer son mot de passe.
   *
   * L'empreinte est redemandée : `exposerUtilisateur` en déduit `aUnMotDePasse`
   * et `changerMotDePasse` la compare. Elle ne ressort jamais pour autant — la
   * projection est une liste d'inclusion, elle ne recopie que ce qu'elle nomme.
   */
  async trouverOuEchouer(id: string): Promise<User> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException("Cet utilisateur n'existe pas.");
    }

    return user;
  }

  /**
   * Met à jour son propre profil.
   *
   * Le DTO ne porte que prénom, nom et photo. Rôle, promotion et statut de
   * finissant en sont absents par construction : ils se calculent, ils ne se
   * déclarent pas.
   */
  mettreAJourProfil(id: string, dto: MettreAJourProfilDto): Promise<User> {
    return this.update(id, {
      ...(dto.prenom !== undefined ? { firstName: dto.prenom } : {}),
      ...(dto.nom !== undefined ? { lastName: dto.nom } : {}),
      ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
    });
  }

  /**
   * Change son mot de passe.
   *
   * L'actuel est exigé : sans lui, un jeton volé — ou un poste laissé ouvert —
   * suffirait à verrouiller le compte de son propriétaire. Les autres sessions
   * sont ensuite coupées, puisque le changement de mot de passe est souvent
   * précisément la réaction à un accès suspect.
   */
  async changerMotDePasse(
    id: string,
    dto: ChangerMotDePasseDto,
  ): Promise<void> {
    const user = await this.trouverOuEchouer(id);

    if (!user.passwordHash) {
      // Cas d'un sponsor invité qui n'a pas encore activé son accès : il n'a
      // pas de mot de passe actuel à confirmer, et doit suivre son invitation.
      throw new BadRequestException(
        "Ce compte n'a pas encore de mot de passe : suivez le lien d'invitation reçu.",
      );
    }

    if (!(await bcrypt.compare(dto.motDePasseActuel, user.passwordHash))) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    if (dto.motDePasseActuel === dto.nouveauMotDePasse) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent de l’actuel.',
      );
    }

    await this.users.update(id, {
      passwordHash: await bcrypt.hash(dto.nouveauMotDePasse, TOURS_BCRYPT),
      refreshTokenHash: null,
    });

    this.logger.log(`Mot de passe change pour l'utilisateur ${id}.`);
  }

  // ──────────────────────────  Administration  ──────────────────────────

  async lister(filtre: FiltreUtilisateurDto): Promise<ResultatPagine<User>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');
    // Empreinte redemandée pour `aUnMotDePasse`, jamais recopiée dans la
    // réponse : le contrôleur projette chaque ligne via `exposerUtilisateur`.
    const requete = this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash');

    if (filtre.role) {
      requete.andWhere('u.role = :role', { role: filtre.role });
    }
    if (filtre.promotion !== undefined) {
      requete.andWhere('u.promotion = :promotion', {
        promotion: filtre.promotion,
      });
    }
    if (filtre.isFinissant !== undefined) {
      requete.andWhere('u.is_finissant = :finissant', {
        finissant: filtre.isFinissant,
      });
    }
    if (filtre.isActive !== undefined) {
      requete.andWhere('u.is_active = :actif', { actif: filtre.isActive });
    }
    if (filtre.recherche) {
      // Paramétré, jamais concaténé : la valeur vient du client.
      const motif = `%${filtre.recherche}%`;
      requete.andWhere(
        new Brackets((q) =>
          q
            .where('u.first_name ILIKE :motif', { motif })
            .orWhere('u.last_name ILIKE :motif', { motif })
            .orWhere('u.email ILIKE :motif', { motif }),
        ),
      );
    }

    requete
      .orderBy(`u.${tri}`, filtre.ordre)
      .skip(filtre.sauter)
      .take(filtre.limite);

    return paginer(await requete.getManyAndCount(), filtre);
  }

  /**
   * Modifie un compte depuis l'administration.
   *
   * Un administrateur ne peut ni se retirer son propre rôle, ni se désactiver.
   * S'il est le dernier, la plateforme deviendrait ingérable : plus personne
   * ne pourrait promouvoir qui que ce soit, et il faudrait intervenir
   * directement en base pour reprendre la main.
   */
  async administrer(
    id: string,
    dto: MettreAJourUtilisateurDto,
    demandeurId: string,
  ): Promise<User> {
    const cible = await this.trouverOuEchouer(id);

    if (id === demandeurId) {
      if (dto.role !== undefined && dto.role !== Role.ADMIN) {
        throw new ForbiddenException(
          'Vous ne pouvez pas retirer votre propre rôle d’administrateur.',
        );
      }
      if (dto.isActive === false) {
        throw new ForbiddenException(
          'Vous ne pouvez pas désactiver votre propre compte.',
        );
      }
    }

    if (
      cible.role === Role.ADMIN &&
      dto.role !== undefined &&
      dto.role !== Role.ADMIN &&
      (await this.compterAdministrateurs()) <= 1
    ) {
      // Sans ce garde-fou, il resterait zéro administrateur et la seule sortie
      // serait une intervention directe en base.
      throw new ForbiddenException(
        'C’est le dernier administrateur : nommez-en un autre avant de retirer ce rôle.',
      );
    }

    const misAJour = await this.update(id, {
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.isFinissant !== undefined
        ? { isFinissant: dto.isFinissant }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    if (dto.isActive === false) {
      // Désactiver sans couper la session laisserait le compte agir jusqu'à
      // l'expiration de son jeton d'accès.
      await this.setRefreshTokenHash(id, null);
    }

    this.logger.log(`Compte ${id} modifié par ${demandeurId}.`);

    return misAJour;
  }

  compterAdministrateurs(): Promise<number> {
    return this.users.countBy({ role: Role.ADMIN, isActive: true });
  }
}
