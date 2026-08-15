import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role } from '../../common/enums/role.enum';
import { Generation } from '../generation/entities/generation.entity';
import { GenerationService } from '../generation/generation.service';
import { MailService } from '../mail/mail.service';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';
import { TypeJeton } from './entities/jeton-auth.entity';
import { JetonService } from './jeton.service';
import { PreferenceEmailService } from '../notification/preference-email.service';

/**
 * Empreinte arbitraire : aucun test de ce fichier ne verifie un mot de
 * passe. Nommee plutot qu'ecrite en clair, pour ne pas ressembler a un secret
 * oublie dans le code.
 */
const EMPREINTE_FACTICE = 'empreinte-sans-signification';

/**
 * Ces règles décident qui entre dans la plateforme et à quel tarif. Une
 * régression y est silencieuse : l'application continuerait de fonctionner,
 * en laissant simplement passer les mauvaises personnes.
 */
describe('AuthService', () => {
  let service: AuthService;
  let userService: jest.Mocked<UserService>;
  let jetonService: jest.Mocked<JetonService>;
  let generationService: jest.Mocked<GenerationService>;
  let mailService: jest.Mocked<MailService>;

  const GENERATION: Generation = { annee: 2027 } as Generation;

  const utilisateur = (surcharges: Partial<User> = {}): User =>
    ({
      id: 'usr-1',
      email: 'etienne.mayack@2027.ucac-icam.com',
      passwordHash: null,
      firstName: 'Etienne',
      lastName: 'Mayack',
      role: Role.VISITOR,
      promotion: null,
      isFinissant: false,
      emailVerifieLe: null,
      refreshTokenHash: null,
      isActive: true,
      ...surcharges,
    }) as User;

  beforeEach(() => {
    userService = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailPourConnexion: jest.fn(),
      findByIdPourRafraichissement: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setRefreshTokenHash: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    jetonService = {
      emettre: jest.fn().mockResolvedValue('jeton-en-clair'),
      consommer: jest.fn(),
    } as unknown as jest.Mocked<JetonService>;

    generationService = {
      trouverActive: jest.fn().mockResolvedValue(GENERATION),
    } as unknown as jest.Mocked<GenerationService>;

    mailService = {
      sendWelcome: jest.fn(),
      sendPasswordReset: jest.fn(),
      envoyerVerificationEmail: jest.fn(),
      envoyerTentativeInscription: jest.fn(),
    } as unknown as jest.Mocked<MailService>;

    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('jwt'),
      verifyAsync: jest.fn(),
    } as unknown as JwtService;

    const config = {
      get: jest.fn((_cle: string, defaut?: string) => defaut),
      getOrThrow: jest.fn(() => 'secret-de-test'),
    } as unknown as ConfigService;

    service = new AuthService(
      userService,
      jetonService,
      generationService,
      mailService,
      {
        autorise: jest.fn().mockResolvedValue(true),
      } as unknown as PreferenceEmailService,
      jwtService,
      config,
    );
  });

  describe('inscription', () => {
    it("normalise l'adresse avant de créer le compte", async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(utilisateur());

      await service.inscrire(
        '  Etienne.Mayack+test@2027.UCAC-ICAM.COM ',
        'motdepasselong42',
        'Etienne',
        'Mayack',
      );

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'etienne.mayack@2027.ucac-icam.com' }),
      );
    });

    it('crée le compte en visiteur, sans promotion, avant vérification', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(utilisateur());

      await service.inscrire(
        'etienne.mayack@2027.ucac-icam.com',
        'motdepasselong42',
        'Etienne',
        'Mayack',
      );

      // Le format de l'adresse ne prouve rien : seul le clic sur le lien le fera.
      const cree = userService.create.mock.calls[0][0];
      expect(cree.role).toBe(Role.VISITOR);
      expect(cree.promotion).toBeUndefined();
      expect(mailService.envoyerVerificationEmail).toHaveBeenCalled();
    });

    it('ne stocke jamais le mot de passe en clair', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(utilisateur());

      await service.inscrire('x@gmail.com', 'motdepasselong42', 'X', 'Y');

      const { passwordHash } = userService.create.mock.calls[0][0];
      expect(passwordHash).not.toBe('motdepasselong42');
      expect(await bcrypt.compare('motdepasselong42', passwordHash!)).toBe(
        true,
      );
    });

    it('écrase une inscription non vérifiée : le vrai propriétaire reprend la main', async () => {
      const imposteur = utilisateur({
        id: 'usr-imposteur',
        // Valeur arbitraire : ce test ne verifie aucun mot de passe, il
        // verifie que l'inscription non verifiee est ecrasee.
        passwordHash: EMPREINTE_FACTICE,
        emailVerifieLe: null,
      });
      userService.findByEmail.mockResolvedValue(imposteur);
      userService.update.mockResolvedValue(imposteur);

      await service.inscrire(
        'etienne.mayack@2027.ucac-icam.com',
        'nouveau-mot-de-passe-42',
        'Etienne',
        'Mayack',
      );

      expect(userService.update).toHaveBeenCalledWith(
        'usr-imposteur',
        expect.objectContaining({ firstName: 'Etienne' }),
      );
      // C'est le nouveau demandeur qui reçoit le lien, donc lui qui prendra le compte.
      expect(mailService.envoyerVerificationEmail).toHaveBeenCalled();
    });

    it('ne touche pas à un compte déjà vérifié et prévient son titulaire', async () => {
      userService.findByEmail.mockResolvedValue(
        utilisateur({ emailVerifieLe: new Date(), passwordHash: 'existant' }),
      );

      await service.inscrire(
        'etienne.mayack@2027.ucac-icam.com',
        'tentative-de-vol-42',
        'Pirate',
        'Anonyme',
      );

      expect(userService.update).not.toHaveBeenCalled();
      expect(userService.create).not.toHaveBeenCalled();
      expect(mailService.envoyerTentativeInscription).toHaveBeenCalled();
      // Aucun lien de vérification : il permettrait de prendre le compte.
      expect(mailService.envoyerVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('vérification de l’email', () => {
    it('accorde le rôle étudiant et la promotion à une adresse institutionnelle', async () => {
      const user = utilisateur();
      jetonService.consommer.mockResolvedValue(user);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...user, ...data }),
      );

      await service.verifierEmail('jeton');

      expect(userService.update).toHaveBeenCalledWith(
        'usr-1',
        expect.objectContaining({
          role: Role.STUDENT,
          promotion: 2027,
          isFinissant: true,
        }),
      );
    });

    it('laisse visiteur une adresse externe', async () => {
      const user = utilisateur({ email: 'quelquun@gmail.com' });
      jetonService.consommer.mockResolvedValue(user);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...user, ...data }),
      );

      await service.verifierEmail('jeton');

      expect(userService.update).toHaveBeenCalledWith(
        'usr-1',
        expect.objectContaining({ role: Role.VISITOR, promotion: null }),
      );
    });

    it('laisse visiteur une adresse de personnel', async () => {
      const user = utilisateur({ email: 'admin@ucac-icam.com' });
      jetonService.consommer.mockResolvedValue(user);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...user, ...data }),
      );

      await service.verifierEmail('jeton');

      // Le rôle ADMIN ne s'obtient jamais depuis une adresse : ce serait une
      // auto-promotion pour quiconque possède une boîte de l'école.
      expect(userService.update).toHaveBeenCalledWith(
        'usr-1',
        expect.objectContaining({ role: Role.VISITOR }),
      );
    });

    it("n'accorde pas le statut de finissant à une autre promotion", async () => {
      const user = utilisateur({ email: 'x@2029.ucac-icam.com' });
      jetonService.consommer.mockResolvedValue(user);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...user, ...data }),
      );

      await service.verifierEmail('jeton');

      expect(userService.update).toHaveBeenCalledWith(
        'usr-1',
        expect.objectContaining({
          role: Role.STUDENT,
          promotion: 2029,
          isFinissant: false,
        }),
      );
    });

    it('refuse un jeton invalide ou expiré', async () => {
      jetonService.consommer.mockResolvedValue(null);

      await expect(service.verifierEmail('faux')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('connexion', () => {
    const empreinteValide = async () => bcrypt.hash('motdepasselong42', 4);

    it('refuse un compte dont l’email n’est pas vérifié', async () => {
      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({
          passwordHash: await empreinteValide(),
          emailVerifieLe: null,
        }),
      );

      await expect(
        service.connecter(
          'etienne.mayack@2027.ucac-icam.com',
          'motdepasselong42',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuse un compte désactivé', async () => {
      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({
          passwordHash: await empreinteValide(),
          emailVerifieLe: new Date(),
          isActive: false,
        }),
      );

      await expect(
        service.connecter(
          'etienne.mayack@2027.ucac-icam.com',
          'motdepasselong42',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuse un compte sans mot de passe défini', async () => {
      // Cas du sponsor invité mais n'ayant pas encore activé son accès.
      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({ passwordHash: null, emailVerifieLe: new Date() }),
      );

      await expect(
        service.connecter('sponsor@entreprise.com', 'nimportequoi42'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('donne le même message quel que soit le motif du refus', async () => {
      const messages: string[] = [];

      userService.findByEmailPourConnexion.mockResolvedValue(null);
      await service
        .connecter('inconnu@gmail.com', 'motdepasselong42')
        .catch((e: Error) => messages.push(e.message));

      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({
          passwordHash: await empreinteValide(),
          emailVerifieLe: new Date(),
        }),
      );
      await service
        .connecter('etienne.mayack@2027.ucac-icam.com', 'mauvais-mot-de-passe')
        .catch((e: Error) => messages.push(e.message));

      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({
          passwordHash: await empreinteValide(),
          emailVerifieLe: null,
        }),
      );
      await service
        .connecter('etienne.mayack@2027.ucac-icam.com', 'motdepasselong42')
        .catch((e: Error) => messages.push(e.message));

      // Trois motifs différents, un seul message : impossible de déduire
      // lesquelles de ces adresses ont un compte.
      expect(messages).toHaveLength(3);
      expect(new Set(messages).size).toBe(1);
    });

    it('accepte un compte vérifié et actif', async () => {
      userService.findByEmailPourConnexion.mockResolvedValue(
        utilisateur({
          passwordHash: await empreinteValide(),
          emailVerifieLe: new Date(),
        }),
      );

      const jetons = await service.connecter(
        'etienne.mayack@2027.ucac-icam.com',
        'motdepasselong42',
      );

      expect(jetons.accessToken).toBeDefined();
      expect(jetons.refreshToken).toBeDefined();
      // Le refresh token est conservé haché, jamais en clair.
      const [, empreinteEnregistree] =
        userService.setRefreshTokenHash.mock.calls[0];
      expect(empreinteEnregistree).not.toBe(jetons.refreshToken);
    });
  });

  describe('réinitialisation', () => {
    it("n'envoie rien pour une adresse inconnue, sans lever d'erreur", async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.demanderReinitialisation('inconnu@gmail.com'),
      ).resolves.toBeUndefined();
      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it("n'envoie rien pour un compte non vérifié", async () => {
      userService.findByEmail.mockResolvedValue(
        utilisateur({ emailVerifieLe: null }),
      );

      await service.demanderReinitialisation(
        'etienne.mayack@2027.ucac-icam.com',
      );

      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('met fin aux sessions ouvertes lors du changement de mot de passe', async () => {
      const user = utilisateur({ emailVerifieLe: new Date() });
      jetonService.consommer.mockResolvedValue(user);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...user, ...data }),
      );

      await service.definirMotDePasse(
        'jeton',
        'nouveau-mot-de-passe-42',
        TypeJeton.REINITIALISATION_MOT_DE_PASSE,
      );

      expect(userService.update).toHaveBeenCalledWith(
        'usr-1',
        expect.objectContaining({ refreshTokenHash: null }),
      );
    });

    it("une invitation sponsor vaut vérification de l'adresse", async () => {
      const sponsor = utilisateur({
        email: 'contact@entreprise.com',
        role: Role.SPONSOR,
        emailVerifieLe: null,
      });
      jetonService.consommer.mockResolvedValue(sponsor);
      userService.update.mockImplementation((_id, data) =>
        Promise.resolve({ ...sponsor, ...data }),
      );

      await service.definirMotDePasse(
        'jeton',
        'mot-de-passe-sponsor-42',
        TypeJeton.INVITATION_SPONSOR,
      );

      // Cliquer sur le lien prouve la possession de la boîte, exactement
      // comme un lien de vérification.
      const [, data] = userService.update.mock.calls[0];
      expect(data.emailVerifieLe).toBeInstanceOf(Date);
    });
  });
});
