import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import {
  Inscription,
  StatutInscription,
} from './../src/modules/billetterie/entities/inscription.entity';
import {
  Evenement,
  TypeEvenement,
} from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from './../src/modules/paiement/enums/paiement.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const EVENEMENTS = '/api/v1/evenements';
const BILLETS = '/api/v1/billets';
const WEBHOOK = '/api/v1/webhooks/fapshi';
const SECRET_WEBHOOK = 'secret-de-developpement';
const ANNEE_ACTIVE = 2027;
const TELEPHONE_EN_ATTENTE = '+237677123456';

/**
 * Transférer le billet payé d'une personne à une autre : qui est prévenu, ce
 * que devient le code d'entrée, et à qui reste la facture.
 */
describe('Transfert de billet (e2e)', () => {
  let app: INestApplication<App>;
  let inscriptions: Repository<Inscription>;
  let transactions: Repository<Transaction>;
  let evenements: Repository<Evenement>;
  let generations: Repository<Generation>;
  let notifications: Repository<Notification>;

  let exploitation: CompteDeTest;
  let bureau: CompteDeTest;
  let ancien: CompteDeTest;
  let nouveau: CompteDeTest;
  let autre: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const creerEvenement = async (
    corps: Record<string, unknown> = {},
  ): Promise<string> => {
    const cree = await request(app.getHttpServer())
      .post(EVENEMENTS)
      .set(exploitation.entetes)
      .send({
        titre: 'Marche rose',
        description: 'Marche solidaire.',
        dateDebut: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        lieu: 'Campus UCAC-ICAM',
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 8000,
        ...corps,
      })
      .expect(201);
    const id = (cree.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/publier`)
      .set(exploitation.entetes)
      .expect(201);
    return id;
  };

  /** Une inscription payée : le webhook de succès la confirme. */
  const inscrirePayee = async (
    evenementId: string,
    qui: CompteDeTest,
  ): Promise<Inscription> => {
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${evenementId}/inscription`)
      .set(qui.entetes)
      .send({
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: TELEPHONE_EN_ATTENTE,
      })
      .expect(201);
    const billet = await inscriptions.findOneOrFail({
      where: { user: { id: qui.user.id }, evenement: { id: evenementId } },
    });
    await request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('x-wh-secret', SECRET_WEBHOOK)
      .send(
        JSON.stringify({
          reference: billet.codeBillet,
          referenceExterne: 'trx_simule',
          statut: StatutPaiement.COMPLETE,
        }),
      )
      .expect(200);
    return inscriptions.findOneOrFail({ where: { id: billet.id } });
  };

  const transferer = (
    billetId: string,
    beneficiaire: CompteDeTest,
    qui: CompteDeTest = exploitation,
  ) =>
    request(app.getHttpServer())
      .post(`${BILLETS}/${billetId}/transfert`)
      .set(qui.entetes)
      .send({ beneficiaireId: beneficiaire.user.id });

  const titresRecus = async (compte: CompteDeTest): Promise<string[]> =>
    (await notifications.find({ where: { user: { id: compte.user.id } } })).map(
      (n) => n.titre,
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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

    inscriptions = app.get(getRepositoryToken(Inscription));
    transactions = app.get(getRepositoryToken(Transaction));
    evenements = app.get(getRepositoryToken(Evenement));
    generations = app.get(getRepositoryToken(Generation));
    notifications = app.get(getRepositoryToken(Notification));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await inscriptions.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: `Promotion ${ANNEE_ACTIVE}`,
        isActive: true,
      }),
    );

    exploitation = await creerCompteAuthentifie(app, {
      role: Role.SUPER_ADMIN,
    });
    bureau = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    ancien = await creerCompteAuthentifie(app, {
      prenom: 'Étienne',
      nom: 'Mayack',
      promotion: ANNEE_ACTIVE,
    });
    nouveau = await creerCompteAuthentifie(app, {
      prenom: 'Marie',
      nom: 'Dupont',
      promotion: ANNEE_ACTIVE,
    });
    autre = await creerCompteAuthentifie(app, {
      prenom: 'Paul',
      nom: 'Essomba',
      promotion: ANNEE_ACTIVE,
    });
  });

  afterAll(async () => {
    await inscriptions.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  it('passe le billet au nouveau titulaire, sans toucher aux places', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);
    const avant = await evenements.findOneByOrFail({ id: evenementId });

    await transferer(billet.id, nouveau).expect(201);

    const apres = await inscriptions.findOneOrFail({
      where: { id: billet.id },
      relations: { user: true },
    });
    expect(apres.user.id).toBe(nouveau.user.id);
    expect(apres.statut).toBe(StatutInscription.CONFIRMEE);
    expect(
      (await evenements.findOneByOrFail({ id: evenementId }))
        .inscriptionsActuelles,
    ).toBe(avant.inscriptionsActuelles);
    expect(await inscriptions.countBy({ evenement: { id: evenementId } })).toBe(
      1,
    );
  });

  it('renouvelle le code d’entrée et garde la référence de paiement', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, nouveau).expect(201);

    const apres = await inscriptions.findOneByOrFail({ id: billet.id });
    expect(apres.codeBillet).not.toBe(billet.codeBillet);
    expect(apres.groupePaiement).toBe(billet.codeBillet);
    // L'ancien QR ne mène plus nulle part.
    await request(app.getHttpServer())
      .post(`${BILLETS}/scanner`)
      .set(exploitation.entetes)
      .send({ codeBillet: billet.codeBillet })
      .expect(404);
  });

  it('laisse la facture à celui qui a payé', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, nouveau).expect(201);

    const apres = await inscriptions.findOneOrFail({
      where: { id: billet.id },
      relations: { payeur: true },
    });
    expect(apres.payeur?.id).toBe(ancien.user.id);
  });

  it('ne prévient que l’ancien titulaire, et envoie son billet au nouveau', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);
    await notifications.createQueryBuilder().delete().execute();
    faussaireMail.envoyerBillet.mockClear();

    await transferer(billet.id, nouveau).expect(201);

    expect(await titresRecus(ancien)).toEqual(['Votre billet a été transféré']);
    const recus = await titresRecus(nouveau);
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatch(/^Inscription confirmée/);
    expect(faussaireMail.envoyerBillet).toHaveBeenCalledTimes(1);
    expect(faussaireMail.envoyerBillet).toHaveBeenCalledWith(
      nouveau.user.email,
      expect.anything(),
      expect.anything(),
    );
    expect(await titresRecus(autre)).toEqual([]);
  });

  it('refuse à un administrateur dont le poste n’y est pas habilité', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, nouveau, bureau).expect(403);

    const apres = await inscriptions.findOneOrFail({
      where: { id: billet.id },
      relations: { user: true },
    });
    expect(apres.user.id).toBe(ancien.user.id);
  });

  it('refuse à qui n’administre pas', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, nouveau, autre).expect(403);
  });

  it('refuse un bénéficiaire déjà inscrit à l’événement', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);
    await inscrirePayee(evenementId, nouveau);

    await transferer(billet.id, nouveau).expect(409);
  });

  it('refuse de transférer à son propre titulaire', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, ancien).expect(400);
  });

  it('refuse un compte désactivé', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);
    const inactif = await creerCompteAuthentifie(app, {
      promotion: ANNEE_ACTIVE,
      isActive: false,
    });

    await transferer(billet.id, inactif).expect(404);
  });

  it('refuse un billet non payé, annulé, déjà utilisé ou dont le lot est remis', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    for (const [statut, extra] of [
      [StatutInscription.EN_ATTENTE, {}],
      [StatutInscription.ANNULEE, {}],
      [StatutInscription.UTILISEE, {}],
      [StatutInscription.CONFIRMEE, { remisLe: new Date() }],
    ] as const) {
      await inscriptions.update(billet.id, { statut, ...extra });
      await transferer(billet.id, nouveau).expect(409);
    }
  });

  it('refuse un événement terminé', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);
    await evenements.update(evenementId, {
      dateDebut: new Date(Date.now() - 2 * 86_400_000),
      dateFin: new Date(Date.now() - 86_400_000),
    });

    await transferer(billet.id, nouveau).expect(409);
  });

  it('répond 404 pour un billet inconnu', async () => {
    await request(app.getHttpServer())
      .post(`${BILLETS}/3f2b8a52-0000-4000-8000-000000000000/transfert`)
      .set(exploitation.entetes)
      .send({ beneficiaireId: nouveau.user.id })
      .expect(404);
  });

  it('le nouveau titulaire retrouve le billet dans le sien', async () => {
    const evenementId = await creerEvenement();
    const billet = await inscrirePayee(evenementId, ancien);

    await transferer(billet.id, nouveau).expect(201);

    await request(app.getHttpServer())
      .get(`${BILLETS}/${billet.id}`)
      .set(nouveau.entetes)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${BILLETS}/${billet.id}`)
      .set(ancien.entetes)
      .expect(404);
  });
});
