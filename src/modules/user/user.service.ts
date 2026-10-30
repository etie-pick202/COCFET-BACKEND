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
import { Role, estAdministrateur } from '../../common/enums/role.enum';
import { lireIdentiteCampus } from '../../common/identite/identite-campus';
import type { ProcheTrouve } from './dto/user.dto';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import {
  ChangerMotDePasseDto,
  FiltreUtilisateurDto,
  MettreAJourProfilDto,
  MettreAJourUtilisateurDto,
} from './dto/user.dto';
import { User } from './entities/user.entity';
import { BureauService } from '../bureau/bureau.service';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { exigerFichierDe } from '../file/propriete-fichier';

const TRIS_AUTORISES = ['createdAt', 'lastName', 'promotion', 'role'] as const;

/** Même coût que celui de l'inscription : les deux empreintes coexistent. */
const TOURS_BCRYPT = 12;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly nettoyage: NettoyageFichiers,
    private readonly bureau: BureauService,
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

  /**
   * Supprime un compte.
   *
   * Un super administrateur ne se supprime que de la main d'un autre : sans
   * `acteur`, l'appel est interne (compte de partenaire retiré avec sa fiche)
   * et ne peut donc pas viser un rôle d'exploitation.
   */
  async supprimer(id: string, acteur?: Role): Promise<void> {
    const user = await this.users.findOne({ where: { id } });

    if (user?.role === Role.SUPER_ADMIN && acteur !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Seul un super administrateur peut supprimer un super administrateur.',
      );
    }

    await this.users.delete(id);

    // Le compte parti, sa photo ne sert plus personne et ne peut plus etre
    // retrouvee : c'est le dernier moment ou l'on connait sa cle.
    await this.nettoyage.retirerDuDossier('avatars', user?.avatar);
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
  async mettreAJourProfil(
    id: string,
    dto: MettreAJourProfilDto,
  ): Promise<User> {
    const avant = await this.trouverOuEchouer(id);
    exigerFichierDe(id, 'avatars', dto.avatar, avant.avatar);

    const misAJour = await this.update(id, {
      ...(dto.prenom !== undefined ? { firstName: dto.prenom } : {}),
      ...(dto.nom !== undefined ? { lastName: dto.nom } : {}),
      ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
    });

    // Apres l'ecriture : une photo effacee avant l'echec de la mise a jour
    // laisserait le compte pointant vers une image disparue.
    await this.nettoyage.remplacer(avant.avatar, dto.avatar, 'avatars');

    return misAJour;
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
    demandeurRole?: Role,
  ): Promise<User> {
    const cible = await this.trouverOuEchouer(id);

    // Désactiver ou rétrograder revient à retirer le compte : même règle que
    // pour la suppression.
    if (cible.role === Role.SUPER_ADMIN && demandeurRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Seul un super administrateur peut modifier un super administrateur.',
      );
    }

    await this.verifierGestionDesAcces(cible, dto, demandeurId, demandeurRole);

    if (id === demandeurId) {
      if (dto.role !== undefined && !estAdministrateur(dto.role)) {
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
      estAdministrateur(cible.role) &&
      dto.role !== undefined &&
      !estAdministrateur(dto.role) &&
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
      ...(await this.attributsEtudiant(cible, dto)),
    });

    if (dto.isActive === false) {
      // Désactiver sans couper la session laisserait le compte agir jusqu'à
      // l'expiration de son jeton d'accès.
      await this.setRefreshTokenHash(id, null);
    }

    this.logger.log(`Compte ${id} modifié par ${demandeurId}.`);

    return misAJour;
  }

  /**
   * Nommer, retirer ou désactiver un administrateur relève des postes qui
   * gèrent les accès.
   *
   * Sans cette règle, n'importe quel administrateur faisait d'un complice un
   * administrateur, et le cloisonnement des postes ne tenait plus. Les autres
   * corrections d'un compte (passer étudiant, corriger une promotion)
   * restent ouvertes à toute l'administration.
   */
  private async verifierGestionDesAcces(
    cible: User,
    dto: MettreAJourUtilisateurDto,
    demandeurId: string,
    demandeurRole?: Role,
  ): Promise<void> {
    const etaitAdmin = estAdministrateur(cible.role);
    const devientAdmin =
      dto.role !== undefined ? estAdministrateur(dto.role) : etaitAdmin;
    const toucheAuxAcces =
      etaitAdmin !== devientAdmin || (etaitAdmin && dto.isActive === false);

    if (!toucheAuxAcces || demandeurRole === Role.SUPER_ADMIN) {
      return;
    }

    if (!(await this.bureau.privilegesDe(demandeurId)).gereAcces) {
      throw new ForbiddenException(
        'Nommer, retirer ou désactiver un administrateur est réservé aux postes qui gèrent les accès.',
      );
    }
  }

  /**
   * La promotion et le marquage de finissant qui suivent un changement de rôle.
   *
   * Tout ce qui concerne les étudiants — l'annuaire, les cotisations ciblées,
   * le tableau de bord — se fonde sur la **promotion**, pas sur le rôle. Passer
   * quelqu'un étudiant sans promotion changeait son badge et rien d'autre : il
   * restait absent de tout. Une adresse institutionnelle donne la promotion ;
   * pour une autre (gmail…), l'administration l'indique, faute de quoi on
   * refuse plutôt que de laisser un étudiant à moitié créé.
   *
   * Repasser visiteur retire la promotion : un visiteur n'en a pas.
   */
  private async attributsEtudiant(
    cible: User,
    dto: MettreAJourUtilisateurDto,
  ): Promise<Partial<User>> {
    if (dto.role === Role.VISITOR && cible.role === Role.STUDENT) {
      return { promotion: null, isFinissant: false };
    }

    const roleFinal = dto.role ?? cible.role;
    const concerne =
      roleFinal === Role.STUDENT &&
      (dto.role === Role.STUDENT || dto.promotion !== undefined);
    if (!concerne) {
      return {};
    }

    const annee = await this.anneeGenerationActive();
    const promotion =
      dto.promotion ??
      cible.promotion ??
      lireIdentiteCampus(cible.email, annee ?? undefined).promotion;

    if (promotion === null) {
      throw new BadRequestException(
        'Indiquez la promotion (année de sortie) de cet étudiant : son adresse ne permet pas de la déduire.',
      );
    }

    return {
      promotion,
      isFinissant: dto.isFinissant ?? (annee !== null && promotion === annee),
    };
  }

  private async anneeGenerationActive(): Promise<number | null> {
    const lignes = await this.users.manager.query<{ annee: number }[]>(
      'SELECT annee FROM generations WHERE is_active = true LIMIT 1',
    );
    return lignes[0]?.annee ?? null;
  }

  /**
   * Retrouve une personne déjà inscrite, pour lui offrir un billet ou régler sa
   * part.
   *
   * N'importe quel membre peut la lancer : elle expose donc le strict minimum.
   * Seuls les comptes actifs et dont l'adresse est confirmée sont proposés,
   * huit au plus, et l'adresse est **masquée** dans la réponse — de quoi
   * reconnaître la bonne personne, pas de quoi collecter des emails. Trois
   * caractères au moins sont exigés, et le débit de la route est limité.
   */
  async rechercherProches(
    demandeurId: string,
    recherche: string,
    evenementId?: string,
  ): Promise<ProcheTrouve[]> {
    const terme = recherche.trim();
    // `%` et `_` sont des jokers de LIKE : tapés par l'utilisateur, ils
    // doivent chercher le caractère lui-même.
    const echappe = terme.replace(/[\\%_]/g, (c) => `\\${c}`);

    const lignes = await this.users.manager.query<
      {
        id: string;
        prenom: string;
        nom: string;
        avatar: string | null;
        email: string;
        promotion: number | null;
      }[]
    >(
      `SELECT u.id, u.first_name AS prenom, u.last_name AS nom, u.avatar,
              u.email, u.promotion
         FROM users u
        WHERE u.is_active = true
          AND u.email_verifie_le IS NOT NULL
          AND u.id <> $1
          AND u.role <> $2
          AND (u.first_name ILIKE $3
               OR u.last_name ILIKE $3
               OR (u.first_name || ' ' || u.last_name) ILIKE $3
               OR (u.last_name || ' ' || u.first_name) ILIKE $3
               OR lower(u.email) = lower($5))
          AND ($4::uuid IS NULL OR NOT EXISTS (
                SELECT 1 FROM inscriptions i
                 WHERE i.user_id = u.id
                   AND i.evenement_id = $4::uuid
                   AND i.statut <> 'ANNULEE'))
        ORDER BY (lower(u.email) = lower($5)) DESC,
                 (u.first_name ILIKE $6 OR u.last_name ILIKE $6) DESC,
                 u.first_name, u.last_name
        LIMIT 8`,
      [
        demandeurId,
        Role.SUPER_ADMIN,
        `%${echappe}%`,
        evenementId ?? null,
        terme,
        `${echappe}%`,
      ],
    );

    return lignes.map((l) => ({
      id: l.id,
      prenom: l.prenom,
      nom: l.nom,
      avatar: l.avatar,
      emailMasque: masquerEmail(l.email),
      promotion: l.promotion,
    }));
  }

  compterAdministrateurs(): Promise<number> {
    return this.users.countBy({ role: Role.ADMIN, isActive: true });
  }
}

/** « marie.dupont@gmail.com » → « m***@gmail.com ». */
export function masquerEmail(email: string): string {
  const arobase = email.lastIndexOf('@');
  if (arobase <= 0) {
    return '***';
  }
  return `${email[0]}***${email.slice(arobase)}`;
}
