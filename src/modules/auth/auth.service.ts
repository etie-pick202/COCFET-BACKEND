import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ApiProperty } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { Role } from '../../common/enums/role.enum';
import {
  lireIdentiteCampus,
  normaliserEmail,
  TypeIdentite,
} from '../../common/identite/identite-campus';
import { GenerationService } from '../generation/generation.service';
import { MailService } from '../mail/mail.service';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { TypeJeton } from './entities/jeton-auth.entity';
import { JetonService } from './jeton.service';
import { JwtPayload } from './strategies/jwt.strategy';

export class PaireJetons {
  @ApiProperty({
    description:
      'À présenter en en-tête « Authorization: Bearer … ». Courte durée de vie.',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Sert uniquement à obtenir un nouveau jeton d’accès. Chaque ' +
      'rafraîchissement invalide le précédent : rejouer un ancien jeton coupe ' +
      'toutes les sessions, le vol étant l’explication la plus probable.',
  })
  refreshToken: string;
}

/**
 * Message unique renvoyé à toute tentative de connexion qui échoue.
 *
 * Distinguer « compte inconnu », « mot de passe faux » et « email non
 * vérifié » permettrait de savoir qui possède un compte. Sur une plateforme
 * où l'adresse révèle la promotion, c'est une donnée personnelle.
 */
const ECHEC_CONNEXION = 'Identifiants invalides.';

@Injectable()
export class AuthService {
  private static readonly TOURS_BCRYPT = 12;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jetonService: JetonService,
    private readonly generationService: GenerationService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inscription.
   *
   * La réponse est **identique quel que soit le cas** : adresse libre, compte
   * non vérifié réutilisé, ou compte déjà actif. Le contrôleur renvoie donc
   * toujours le même message, et c'est le contenu de l'email — ou son absence
   * — qui distingue les situations.
   */
  async inscrire(
    email: string,
    motDePasse: string,
    prenom: string,
    nom: string,
  ): Promise<void> {
    const normalise = normaliserEmail(email);
    const existant = await this.userService.findByEmail(normalise);

    if (existant?.emailVerifieLe) {
      // Le compte est actif : on ne le modifie pas, et on prévient son
      // propriétaire que quelqu'un a tenté de s'inscrire avec son adresse.
      await this.mailService.envoyerTentativeInscription(
        existant.email,
        existant.firstName,
      );
      return;
    }

    const passwordHash = await this.hacherMotDePasse(motDePasse);

    // Une inscription non vérifiée est écrasée : si un imposteur a pris une
    // adresse institutionnelle sans pouvoir la vérifier, le véritable
    // propriétaire reprend la main en s'inscrivant à son tour.
    const user = existant
      ? await this.userService.update(existant.id, {
          passwordHash,
          firstName: prenom,
          lastName: nom,
        })
      : await this.userService.create({
          email: normalise,
          passwordHash,
          firstName: prenom,
          lastName: nom,
          role: Role.VISITOR,
        });

    await this.envoyerVerification(user);
  }

  /**
   * Consomme un jeton de vérification et active le compte.
   *
   * C'est ici, et seulement ici, que le rôle étudiant est accordé : recevoir
   * l'email est la seule preuve que l'adresse institutionnelle appartient bien
   * à la personne qui s'inscrit.
   */
  async verifierEmail(jeton: string): Promise<PaireJetons> {
    const user = await this.jetonService.consommer(
      jeton,
      TypeJeton.VERIFICATION_EMAIL,
    );

    if (!user) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    const misAJour = await this.userService.update(user.id, {
      emailVerifieLe: new Date(),
      ...(await this.attributsCampus(user.email)),
    });

    await this.mailService.sendWelcome(misAJour.email, misAJour.firstName);

    return this.ouvrirSession(misAJour);
  }

  /** Renvoie un lien de vérification, sans révéler si le compte existe. */
  async renvoyerVerification(email: string): Promise<void> {
    const user = await this.userService.findByEmail(normaliserEmail(email));
    if (user && !user.emailVerifieLe) {
      await this.envoyerVerification(user);
    }
  }

  async connecter(email: string, motDePasse: string): Promise<PaireJetons> {
    const user = await this.userService.findByEmailPourConnexion(
      normaliserEmail(email),
    );

    // Une comparaison est effectuée même sans compte, pour que le temps de
    // réponse ne trahisse pas l'existence de l'adresse.
    const empreinte = user?.passwordHash ?? (await this.empreinteLeurre());
    const motDePasseValide = await bcrypt.compare(motDePasse, empreinte);

    if (!user?.passwordHash || !motDePasseValide) {
      throw new UnauthorizedException(ECHEC_CONNEXION);
    }
    if (!user.emailVerifieLe || !user.isActive) {
      throw new UnauthorizedException(ECHEC_CONNEXION);
    }

    return this.ouvrirSession(user);
  }

  /**
   * Rotation du refresh token.
   *
   * Chaque rafraîchissement invalide le précédent. Rejouer un ancien jeton
   * échoue donc, ce qui limite la fenêtre d'exploitation d'un vol.
   */
  async rafraichir(refreshToken: string): Promise<PaireJetons> {
    let charge: JwtPayload;
    try {
      charge = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Session expirée.');
    }

    const user = await this.userService.findByIdPourRafraichissement(
      charge.sub,
    );
    if (!user?.refreshTokenHash || !user.isActive) {
      throw new UnauthorizedException('Session expirée.');
    }

    const correspond = JetonService.empreintesIdentiques(
      this.empreinteRefresh(refreshToken),
      user.refreshTokenHash,
    );
    if (!correspond) {
      // Le jeton est valide cryptographiquement mais n'est plus celui en
      // cours : il a déjà été utilisé. On coupe toutes les sessions, le vol
      // étant l'explication la plus probable.
      await this.userService.setRefreshTokenHash(user.id, null);
      this.logger.warn(
        `Refresh token rejoué pour l'utilisateur ${user.id} : sessions révoquées.`,
      );
      throw new UnauthorizedException('Session expirée.');
    }

    return this.ouvrirSession(user);
  }

  async deconnecter(userId: string): Promise<void> {
    await this.userService.setRefreshTokenHash(userId, null);
  }

  /** Demande de réinitialisation, sans révéler si l'adresse est connue. */
  async demanderReinitialisation(email: string): Promise<void> {
    const user = await this.userService.findByEmail(normaliserEmail(email));
    if (!user?.emailVerifieLe) {
      return;
    }

    const jeton = await this.jetonService.emettre(
      user,
      TypeJeton.REINITIALISATION_MOT_DE_PASSE,
    );
    await this.mailService.sendPasswordReset(
      user.email,
      user.firstName,
      this.lienFrontal('reinitialisation', jeton),
    );
  }

  /**
   * Définit un nouveau mot de passe depuis un jeton de réinitialisation ou
   * d'invitation sponsor.
   *
   * Une invitation vaut également vérification : le clic prouve la possession
   * de la boîte, exactement comme un lien de vérification.
   */
  async definirMotDePasse(
    jeton: string,
    motDePasse: string,
    type: TypeJeton,
  ): Promise<PaireJetons> {
    const user = await this.jetonService.consommer(jeton, type);
    if (!user) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    const misAJour = await this.userService.update(user.id, {
      passwordHash: await this.hacherMotDePasse(motDePasse),
      emailVerifieLe: user.emailVerifieLe ?? new Date(),
      // Changer de mot de passe met fin aux sessions ouvertes ailleurs.
      refreshTokenHash: null,
    });

    return this.ouvrirSession(misAJour);
  }

  /**
   * Demande le remplacement de l'adresse de connexion.
   *
   * Le mot de passe actuel est exigé. Sans lui, un jeton volé — ou un poste
   * laissé ouvert — suffirait à s'approprier le compte : il suffirait de
   * basculer l'identifiant sur une adresse que l'on contrôle, puis de demander
   * une réinitialisation de mot de passe.
   *
   * Rien ne change tant que la nouvelle boîte n'a pas répondu : la connexion
   * continue de se faire avec l'ancienne adresse. Une bascule immédiate
   * enfermerait dehors quiconque se trompe en saisissant.
   */
  async demanderChangementEmail(
    userId: string,
    nouvelEmail: string,
    motDePasse: string,
  ): Promise<void> {
    const user = await this.userService.trouverOuEchouer(userId);

    if (!user.passwordHash) {
      throw new BadRequestException(
        "Ce compte n'a pas encore de mot de passe : suivez d'abord le lien reçu.",
      );
    }
    if (!(await bcrypt.compare(motDePasse, user.passwordHash))) {
      throw new UnauthorizedException('Le mot de passe est incorrect.');
    }

    const normalise = normaliserEmail(nouvelEmail);

    if (normalise === user.email) {
      throw new BadRequestException('C’est déjà votre adresse actuelle.');
    }

    const occupe = await this.userService.findByEmail(normalise);
    if (occupe) {
      // Un message franc, contrairement à l'inscription : la personne est
      // authentifiée, elle ne découvre donc rien qu'elle ne puisse déjà
      // apprendre en tentant de s'inscrire.
      throw new ConflictException('Cette adresse est déjà utilisée.');
    }

    await this.userService.update(userId, { emailEnAttente: normalise });

    const jeton = await this.jetonService.emettre(
      user,
      TypeJeton.CHANGEMENT_EMAIL,
    );

    await this.mailService.envoyerConfirmationNouvelleAdresse(
      normalise,
      user.firstName,
      this.lienFrontal('changement-email', jeton),
    );

    // L'ancienne adresse est prévenue : c'est ce qui permet au titulaire
    // légitime de réagir si la demande ne vient pas de lui.
    await this.mailService.envoyerAlerteChangementEmail(
      user.email,
      user.firstName,
      normalise,
    );
  }

  /**
   * Confirme la nouvelle adresse et la rend effective.
   *
   * Les attributs campus sont **recalculés** : l'adresse est ce qui atteste
   * l'appartenance à une promotion, et prouver la possession d'une adresse
   * institutionnelle vaut exactement ce que vaut la vérification initiale.
   *
   * Les rôles ADMIN et SPONSOR ne bougent pas : ils viennent du bureau ou d'un
   * partenariat, pas d'un nom de domaine. Sans cette réserve, un membre du
   * bureau perdrait ses droits en changeant d'adresse.
   */
  async confirmerChangementEmail(jeton: string): Promise<PaireJetons> {
    const user = await this.jetonService.consommer(
      jeton,
      TypeJeton.CHANGEMENT_EMAIL,
    );

    if (!user?.emailEnAttente) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    // Vérifié à nouveau ici : l'adresse a pu être prise entre la demande et la
    // confirmation, et l'index unique ferait échouer la mise à jour sans que
    // la personne comprenne pourquoi.
    const occupe = await this.userService.findByEmail(user.emailEnAttente);
    if (occupe) {
      await this.userService.update(user.id, { emailEnAttente: null });
      throw new ConflictException(
        'Cette adresse a été prise entre-temps. Recommencez avec une autre.',
      );
    }

    const campus = await this.attributsCampus(user.emailEnAttente);
    const conserveSonRole =
      user.role === Role.ADMIN || user.role === Role.SPONSOR;

    const misAJour = await this.userService.update(user.id, {
      email: user.emailEnAttente,
      emailEnAttente: null,
      emailVerifieLe: new Date(),
      promotion: campus.promotion,
      isFinissant: campus.isFinissant,
      ...(conserveSonRole ? {} : { role: campus.role }),
      // L'identifiant de connexion change : les sessions ouvertes ailleurs
      // n'ont plus lieu d'être.
      refreshTokenHash: null,
    });

    this.logger.log(`Adresse de connexion changée pour ${misAJour.id}.`);

    return this.ouvrirSession(misAJour);
  }

  /**
   * Empreinte servant de leurre quand aucun compte ne correspond.
   *
   * Elle est calculee au premier besoin plutot qu'ecrite en dur : une valeur
   * litterale ne serait pas garantie valide, et bcrypt.compare rendrait alors
   * la main immediatement — la difference de temps trahirait justement
   * l'absence de compte, ce que cette comparaison cherche a masquer.
   */
  private leurre: string | null = null;

  private async empreinteLeurre(): Promise<string> {
    this.leurre ??= await bcrypt.hash(randomUUID(), AuthService.TOURS_BCRYPT);
    return this.leurre;
  }

  hacherMotDePasse(motDePasse: string): Promise<string> {
    return bcrypt.hash(motDePasse, AuthService.TOURS_BCRYPT);
  }

  /**
   * Déduit rôle, promotion et statut de finissant depuis l'adresse.
   * Appelé uniquement après vérification.
   */
  private async attributsCampus(
    email: string,
  ): Promise<Pick<User, 'role' | 'promotion' | 'isFinissant'>> {
    const generation = await this.generationService.trouverActive();
    const identite = lireIdentiteCampus(email, generation?.annee);

    if (identite.type !== TypeIdentite.ETUDIANT) {
      // Le personnel et les externes restent visiteurs : le rôle ADMIN n'est
      // jamais attribuable depuis une adresse, sous peine d'auto-promotion.
      return { role: Role.VISITOR, promotion: null, isFinissant: false };
    }

    return {
      role: Role.STUDENT,
      promotion: identite.promotion,
      isFinissant:
        generation !== null && identite.promotion === generation.annee,
    };
  }

  private async envoyerVerification(user: User): Promise<void> {
    const jeton = await this.jetonService.emettre(
      user,
      TypeJeton.VERIFICATION_EMAIL,
    );
    await this.mailService.envoyerVerificationEmail(
      user.email,
      user.firstName,
      this.lienFrontal('verification-email', jeton),
    );
  }

  private lienFrontal(chemin: string, jeton: string): string {
    const base = this.config
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')[0];
    return `${base}/${chemin}?jeton=${encodeURIComponent(jeton)}`;
  }

  /**
   * Empreinte du refresh token.
   *
   * SHA-256 et non bcrypt : **bcrypt tronque silencieusement au-dela de 72
   * octets**. Un JWT depasse largement cette taille, si bien que deux jetons
   * ne differant que par leur fin seraient consideres identiques — la rotation
   * ne protegerait alors plus rien. bcrypt sert a ralentir les attaques sur des
   * secrets devinables ; un JWT est deja aleatoire et n'en a pas besoin.
   */
  private empreinteRefresh(jeton: string): string {
    return createHash('sha256').update(jeton).digest('hex');
  }

  private async ouvrirSession(user: User): Promise<PaireJetons> {
    const jetons = await this.emettreJetons(user);
    await this.userService.setRefreshTokenHash(
      user.id,
      this.empreinteRefresh(jetons.refreshToken),
    );
    return jetons;
  }

  private async emettreJetons(user: User): Promise<PaireJetons> {
    const charge: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...charge, jti: randomUUID() }),
      // jti indispensable ici : deux jetons signes dans la meme seconde avec
      // la meme charge utile seraient identiques, et la rotation n'aurait
      // aucun effet.
      this.jwtService.signAsync({ ...charge, jti: randomUUID() }, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
      } as JwtSignOptions),
    ]);

    return { accessToken, refreshToken };
  }
}
