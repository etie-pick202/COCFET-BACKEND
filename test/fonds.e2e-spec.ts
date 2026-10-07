import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import { MouvementFonds } from './../src/modules/fonds/entities/mouvement-fonds.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { Retrait } from './../src/modules/paiement/entities/retrait.entity';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import { StatutRetrait } from './../src/modules/paiement/enums/paiement.enum';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const FONDS = '/api/v1/fonds';
const ANNEE = 2027;

interface Poche {
  membre: { id: string };
  detient: number;
  enRoute: number;
}

/**
 * Le suivi des fonds, de bout en bout : où est l'argent, poche par poche.
 *
 * Ce qui ne se constate que contre un vrai Postgres : le cloisonnement par
 * privilège, le plafond d'une sortie sur ce que le membre détient, et le
 * rattachement d'un retrait Fapshi à un membre.
 */
describe('Suivi des fonds (e2e)', () => {
  let app: INestApplication<App>;
  let mouvements: Repository<MouvementFonds>;
  let retraits: Repository<Retrait>;
  let transactions: Repository<Transaction>;
  let generations: Repository<Generation>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;

  let tresoriere: CompteDeTest;
  let vice: CompteDeTest;
  let finissant: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  const declarer = (compte: CompteDeTest, corps: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`${FONDS}/mouvements`)
      .set(compte.entetes)
      .send(corps);

  const poches = async (): Promise<Poche[]> => {
    const reponse = await request(app.getHttpServer())
      .get(`${FONDS}/suivi`)
      .set(tresoriere.entetes)
      .expect(200);
    return (reponse.body as { poches: Poche[] }).poches;
  };

  const detient = async (compte: CompteDeTest): Promise<number | undefined> =>
    (await poches()).find((p) => p.membre.id === compte.user.id)?.detient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new FiltreExceptionGlobal());
    await app.init();

    mouvements = app.get(getRepositoryToken(MouvementFonds));
    retraits = app.get(getRepositoryToken(Retrait));
    transactions = app.get(getRepositoryToken(Transaction));
    generations = app.get(getRepositoryToken(Generation));
    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
  });

  const purger = async (): Promise<void> => {
    await mouvements.createQueryBuilder().delete().execute();
    await retraits.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();

    const generation = await generations.save(
      generations.create({ annee: ANNEE, nom: 'ATLAS', isActive: true }),
    );
    const poste = await postes.save(
      postes.create({ nom: 'Trésorière', accedeTresorerie: true }),
    );
    const posteVice = await postes.save(
      postes.create({ nom: 'Vice-trésorier', accedeTresorerie: true }),
    );

    tresoriere = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE,
      isFinissant: false,
    });
    vice = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE,
      isFinissant: false,
    });
    finissant = await creerCompteAuthentifie(app, {
      promotion: ANNEE,
      isFinissant: true,
    });

    await membres.save(
      membres.create({
        generation,
        poste,
        user: { id: tresoriere.user.id } as User,
      }),
    );
    await membres.save(
      membres.create({
        generation,
        poste: posteVice,
        user: { id: vice.user.id } as User,
      }),
    );
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('cloisonnement', () => {
    it('réserve le suivi à la trésorerie', async () => {
      await request(app.getHttpServer())
        .get(`${FONDS}/suivi`)
        .set(finissant.entetes)
        .expect(403);
      await declarer(finissant, { type: 'RECEPTION', montant: 1000 }).expect(
        403,
      );
    });

    it('refuse sans connexion', async () => {
      await request(app.getHttpServer()).get(`${FONDS}/suivi`).expect(401);
    });
  });

  describe('membres', () => {
    it('liste ceux qui peuvent détenir de l’argent', async () => {
      const reponse = await request(app.getHttpServer())
        .get(`${FONDS}/membres`)
        .set(tresoriere.entetes)
        .expect(200);

      const ids = (reponse.body as { id: string }[]).map((m) => m.id);
      expect(ids).toEqual(
        expect.arrayContaining([tresoriere.user.id, vice.user.id]),
      );
      expect(ids).not.toContain(finissant.user.id);
    });
  });

  describe('poches', () => {
    it('crédite la poche de qui déclare avoir reçu de l’argent', async () => {
      const reponse = await declarer(tresoriere, {
        type: 'RECEPTION',
        montant: 30_000,
        libelleTiers: 'Délégué de classe',
        piece: 'justificatifs/recu.png',
      }).expect(201);

      expect(reponse.body).toMatchObject({
        mouvement: {
          type: 'RECEPTION',
          montant: 30_000,
          origine: 'Délégué de classe',
          piece: 'justificatifs/recu.png',
        },
        urlPaiement: null,
      });
      expect(await detient(tresoriere)).toBe(30_000);
    });

    it('refuse une sortie plus grosse que la poche', async () => {
      await declarer(tresoriere, { type: 'RECEPTION', montant: 10_000 }).expect(
        201,
      );

      const reponse = await declarer(tresoriere, {
        type: 'DEPENSE',
        montant: 10_001,
        libelleTiers: 'Traiteur',
      }).expect(409);

      expect((reponse.body as { message: string }).message).toContain(
        'ne détient que',
      );
      expect(await detient(tresoriere)).toBe(10_000);
    });

    it('passe l’argent d’une poche à l’autre', async () => {
      await declarer(tresoriere, { type: 'RECEPTION', montant: 20_000 }).expect(
        201,
      );

      await declarer(tresoriere, {
        type: 'TRANSFERT',
        montant: 5_000,
        contrepartieId: vice.user.id,
      }).expect(201);

      expect(await detient(tresoriere)).toBe(15_000);
      expect(await detient(vice)).toBe(5_000);
    });

    it('laisse la trésorerie saisir pour un autre membre, et le dit', async () => {
      await declarer(tresoriere, {
        type: 'RECEPTION',
        montant: 8_000,
        membreId: vice.user.id,
      }).expect(201);

      expect(await detient(vice)).toBe(8_000);
      const journal = await request(app.getHttpServer())
        .get(`${FONDS}/mouvements`)
        .set(tresoriere.entetes)
        .expect(200);
      expect(
        (
          journal.body as {
            donnees: { declarePar: { id: string } }[];
          }
        ).donnees[0].declarePar.id,
      ).toBe(tresoriere.user.id);
    });

    it('refuse un montant nul, une pièce hors justificatifs, un type inconnu', async () => {
      await declarer(tresoriere, { type: 'RECEPTION', montant: 0 }).expect(400);
      await declarer(tresoriere, {
        type: 'RECEPTION',
        montant: 1000,
        piece: '../../etc/passwd',
      }).expect(400);
      await declarer(tresoriere, { type: 'MAGIE', montant: 1000 }).expect(400);
    });
  });

  describe('retraits Fapshi', () => {
    const retrait = () =>
      retraits.save(
        retraits.create({
          referenceExterne: `P-${Date.now()}`,
          montant: 12_000,
          statut: StatutRetrait.REUSSI,
          initieLe: new Date(),
        }),
      );

    it('compte un retrait non attribué à part, puis dans la poche attribuée', async () => {
      const { id } = await retrait();

      const avant = await request(app.getHttpServer())
        .get(`${FONDS}/suivi`)
        .set(tresoriere.entetes)
        .expect(200);
      expect(avant.body).toMatchObject({
        nonAttribue: 12_000,
        retraitsNonAttribues: 1,
        totalPoches: 0,
      });

      await request(app.getHttpServer())
        .patch(`${FONDS}/retraits/${id}`)
        .set(tresoriere.entetes)
        .send({ detenteurId: vice.user.id })
        .expect(200);

      const apres = await request(app.getHttpServer())
        .get(`${FONDS}/suivi`)
        .set(tresoriere.entetes)
        .expect(200);
      expect(apres.body).toMatchObject({ nonAttribue: 0, totalPoches: 12_000 });
      expect(await detient(vice)).toBe(12_000);
    });

    it('détache un retrait quand on passe null', async () => {
      const { id } = await retrait();
      await request(app.getHttpServer())
        .patch(`${FONDS}/retraits/${id}`)
        .set(tresoriere.entetes)
        .send({ detenteurId: vice.user.id })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`${FONDS}/retraits/${id}`)
        .set(tresoriere.entetes)
        .send({ detenteurId: null })
        .expect(200);

      expect(await detient(vice)).toBeUndefined();
    });

    it('refuse un identifiant de membre qui n’est pas un uuid', async () => {
      const { id } = await retrait();
      await request(app.getHttpServer())
        .patch(`${FONDS}/retraits/${id}`)
        .set(tresoriere.entetes)
        .send({ detenteurId: 'pas-un-uuid' })
        .expect(400);
    });
  });

  describe('dépôt sur la plateforme', () => {
    it('refuse un dépôt plus gros que la poche', async () => {
      await declarer(tresoriere, {
        type: 'DEPOT_PLATEFORME',
        montant: 5_000,
      }).expect(409);
    });

    it('ouvre un paiement de type remise, qui n’est pas une recette', async () => {
      await declarer(tresoriere, { type: 'RECEPTION', montant: 20_000 }).expect(
        201,
      );

      const reponse = await declarer(tresoriere, {
        type: 'DEPOT_PLATEFORME',
        montant: 10_000,
      }).expect(201);

      const { mouvement } = reponse.body as {
        mouvement: { reference: string; statut: string };
      };
      expect(mouvement.reference).toMatch(/^REM-/);

      const transaction = await transactions.findOneByOrFail({
        reference: mouvement.reference,
      });
      expect(transaction.origine).toBe('REMISE');
      expect(transaction.montant).toBe(10_000);
    });
  });
});
