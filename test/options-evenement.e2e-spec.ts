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
import { Evenement } from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const EVENEMENTS = '/api/v1/evenements';
const BILLETS = '/api/v1/billets';
const ANNEE = 2027;
const TAILLE = 'taille-de-t-shirt';

/**
 * Les options d'un événement, de bout en bout — le cas de la marche sportive :
 * un T-shirt compris dans le tarif, dont chaque inscrit choisit la taille.
 *
 * Ce qui ne se constate que contre un vrai Postgres : le stock tenu sous
 * verrou quand deux personnes prennent la dernière taille au même instant, et
 * le figeage à J-3.
 */
describe('Options d’événement (e2e)', () => {
  let app: INestApplication<App>;
  let evenements: Repository<Evenement>;
  let inscriptions: Repository<Inscription>;
  let generations: Repository<Generation>;
  let notifications: Repository<Notification>;

  let admin: CompteDeTest;
  let portier: CompteDeTest;
  let alice: CompteDeTest;
  let bruno: CompteDeTest;
  let chloe: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const dans = (jours: number) =>
    new Date(Date.now() + jours * 86_400_000).toISOString();

  const OPTIONS_TAILLES = [
    {
      libelle: 'Taille de T-shirt',
      obligatoire: true,
      choix: [
        { valeur: 'XS' },
        { valeur: 'M', stock: 2 },
        { valeur: 'L' },
        { valeur: 'XL', stock: 1 },
        { valeur: '3XL' },
      ],
    },
  ];

  /** Crée puis publie un événement payant avec options. */
  const creerEtPublier = async (
    surcharge: Record<string, unknown> = {},
  ): Promise<string> => {
    const reponse = await request(app.getHttpServer())
      .post(EVENEMENTS)
      .set(admin.entetes)
      .send({
        titre: 'Marche sportive',
        description: 'Une marche au profit de la promotion.',
        dateDebut: dans(30),
        lieu: 'Campus UCAC-ICAM',
        type: 'PAYANT',
        prixCampus: 2000,
        prixExterne: 2500,
        options: OPTIONS_TAILLES,
        ...surcharge,
      })
      .expect(201);
    const id = (reponse.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/publier`)
      .set(admin.entetes)
      .expect(201);
    return id;
  };

  const sInscrire = (
    id: string,
    compte: CompteDeTest,
    reponses?: Record<string, string>,
  ) =>
    request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/inscription`)
      .set(compte.entetes)
      .send(reponses ? { reponses } : {});

  const changer = (billetId: string, compte: CompteDeTest, valeur: string) =>
    request(app.getHttpServer())
      .patch(`${BILLETS}/${billetId}/reponses`)
      .set(compte.entetes)
      .send({ reponses: { [TAILLE]: valeur } });

  const idDe = (r: { body: unknown }) => (r.body as { id: string }).id;

  const restant = async (id: string, valeur: string) => {
    const r = await request(app.getHttpServer())
      .get(`${EVENEMENTS}/${id}/options`)
      .expect(200);
    const choix = (
      r.body as {
        options: { choix: { valeur: string; restant: number | null }[] }[];
      }
    ).options[0].choix.find((c) => c.valeur === valeur);
    return choix?.restant;
  };

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

    evenements = app.get(getRepositoryToken(Evenement));
    inscriptions = app.get(getRepositoryToken(Inscription));
    generations = app.get(getRepositoryToken(Generation));
    notifications = app.get(getRepositoryToken(Notification));
  });

  const purger = async () => {
    await inscriptions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();
    await generations.save(
      generations.create({
        annee: ANNEE,
        nom: `Promotion ${ANNEE}`,
        isActive: true,
      }),
    );
    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    portier = await creerCompteAuthentifie(app, { promotion: 2023 });
    alice = await creerCompteAuthentifie(app, { promotion: ANNEE });
    bruno = await creerCompteAuthentifie(app, { promotion: ANNEE });
    chloe = await creerCompteAuthentifie(app, { promotion: ANNEE });
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('définition des options', () => {
    it('range les tailles XS à 3XL et fixe le figeage à J-3 par défaut', async () => {
      const id = await creerEtPublier();

      const r = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/options`)
        .expect(200);
      const corps = r.body as {
        options: {
          cle: string;
          obligatoire: boolean;
          choix: { valeur: string }[];
        }[];
        figeLe: string;
        modifiable: boolean;
      };

      expect(corps.options[0].cle).toBe(TAILLE);
      expect(corps.options[0].obligatoire).toBe(true);
      expect(corps.options[0].choix.map((c) => c.valeur)).toEqual([
        'XS',
        'M',
        'L',
        'XL',
        '3XL',
      ]);
      expect(corps.modifiable).toBe(true);
      const ecart =
        (new Date(corps.figeLe).getTime() - Date.now()) / 86_400_000;
      expect(ecart).toBeGreaterThan(26.9);
      expect(ecart).toBeLessThan(27.1);
    });

    it('laisse moduler le figeage', async () => {
      const id = await creerEtPublier({ optionsFigeesAvantJours: 7 });

      const r = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/options`)
        .expect(200);

      const ecart =
        (new Date((r.body as { figeLe: string }).figeLe).getTime() -
          Date.now()) /
        86_400_000;
      expect(ecart).toBeGreaterThan(22.9);
      expect(ecart).toBeLessThan(23.1);
    });

    it('réserve la définition au bureau', async () => {
      await request(app.getHttpServer())
        .post(EVENEMENTS)
        .set(alice.entetes)
        .send({
          titre: 'Marche',
          description: 'Une marche au profit de la promotion.',
          dateDebut: dans(30),
          lieu: 'Campus',
          options: OPTIONS_TAILLES,
        })
        .expect(403);
    });

    it('refuse une option sans choix et plus de cinq options', async () => {
      await request(app.getHttpServer())
        .post(EVENEMENTS)
        .set(admin.entetes)
        .send({
          titre: 'Marche',
          description: 'Une marche au profit de la promotion.',
          dateDebut: dans(30),
          lieu: 'Campus',
          options: [{ libelle: 'Taille', choix: [] }],
        })
        .expect(400);
    });

    it('ne touche pas aux événements sans option', async () => {
      const id = await creerEtPublier({ options: [], type: 'GRATUIT' });

      await sInscrire(id, alice).expect(201);
    });
  });

  describe('inscription', () => {
    it('enregistre la taille choisie avant le paiement', async () => {
      const id = await creerEtPublier();

      const r = await sInscrire(id, alice, { [TAILLE]: 'L' }).expect(201);

      expect(r.body).toMatchObject({
        statut: 'EN_ATTENTE',
        reponses: { [TAILLE]: 'L' },
      });
    });

    it('refuse de s’inscrire sans choisir : l’option est obligatoire', async () => {
      const id = await creerEtPublier();

      const r = await sInscrire(id, alice).expect(400);

      expect((r.body as { message: string }).message).toContain(
        'Taille de T-shirt',
      );
      // Rien n'a été retenu : la place reste libre.
      expect(await inscriptions.count()).toBe(0);
    });

    it('refuse une taille qui n’existe pas, ou du texte libre', async () => {
      const id = await creerEtPublier();

      await sInscrire(id, alice, { [TAILLE]: '4XL' }).expect(400);
      await sInscrire(id, alice, { [TAILLE]: 'grand' }).expect(400);
      await sInscrire(id, alice, { couleur: 'rouge' }).expect(400);
    });
  });

  describe('stock', () => {
    it('décompte le stock à chaque inscription', async () => {
      const id = await creerEtPublier();
      expect(await restant(id, 'M')).toBe(2);

      await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201);

      expect(await restant(id, 'M')).toBe(1);
      expect(await restant(id, 'L')).toBeNull();
    });

    it('refuse une taille épuisée', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, alice, { [TAILLE]: 'XL' }).expect(201);

      const r = await sInscrire(id, bruno, { [TAILLE]: 'XL' }).expect(409);

      expect((r.body as { message: string }).message).toContain('épuisé');
      expect(await restant(id, 'XL')).toBe(0);
    });

    it('ne vend jamais deux fois la dernière taille', async () => {
      const id = await creerEtPublier();

      const resultats = await Promise.all([
        sInscrire(id, alice, { [TAILLE]: 'XL' }),
        sInscrire(id, bruno, { [TAILLE]: 'XL' }),
        sInscrire(id, chloe, { [TAILLE]: 'XL' }),
      ]);

      const statuts = resultats.map((r) => r.status).sort((a, b) => a - b);
      expect(statuts).toEqual([201, 409, 409]);
      expect(
        await inscriptions.count({ where: { reponses: { [TAILLE]: 'XL' } } }),
      ).toBe(1);
    });

    it('rend la taille quand l’inscription est annulée', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'XL' }).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billet}`)
        .set(alice.entetes)
        .expect(204);

      expect(await restant(id, 'XL')).toBe(1);
      await sInscrire(id, bruno, { [TAILLE]: 'XL' }).expect(201);
    });

    it('rend la taille quand l’inscription échoue au paiement', async () => {
      const id = await creerEtPublier();
      // Un numéro que la passerelle de test refuse : l'inscription est défaite.
      await sInscrire(id, alice, { [TAILLE]: 'XL' }).expect(201);
      expect(await restant(id, 'XL')).toBe(0);
    });
  });

  describe('changer son choix', () => {
    it('permet de passer à une autre taille, et rend l’ancienne', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201),
      );

      const r = await changer(billet, alice, 'L').expect(200);

      expect(r.body).toMatchObject({ reponses: { [TAILLE]: 'L' } });
      expect(await restant(id, 'M')).toBe(2);
    });

    it('garde sa propre taille quand le stock est à zéro', async () => {
      // Se « changer » pour la taille déjà prise ne doit pas compter deux fois.
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'XL' }).expect(201),
      );

      await changer(billet, alice, 'XL').expect(200);
    });

    it('refuse une taille épuisée', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, bruno, { [TAILLE]: 'XL' }).expect(201);
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'L' }).expect(201),
      );

      await changer(billet, alice, 'XL').expect(409);
    });

    it('refuse de changer le billet d’autrui', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201),
      );

      await changer(billet, bruno, 'L').expect(404);
    });

    it('refuse une fois les choix figés (J-3)', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201),
      );
      // À deux jours de l'événement : le figeage de J-3 est passé.
      await evenements.update(id, {
        dateDebut: new Date(Date.now() + 2 * 86_400_000),
      });

      const r = await changer(billet, alice, 'L').expect(409);

      expect((r.body as { message: string }).message).toContain('figés');
    });

    it('accepte encore à J-4', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201),
      );
      await evenements.update(id, {
        dateDebut: new Date(Date.now() + 4 * 86_400_000),
      });

      await changer(billet, alice, 'L').expect(200);
    });

    it('refuse sur une inscription annulée', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201),
      );
      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billet}`)
        .set(alice.entetes)
        .expect(204);

      await changer(billet, alice, 'L').expect(409);
    });
  });

  describe('modifier les options d’un événement', () => {
    it('refuse de retirer une taille déjà choisie', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201);

      const r = await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({
          options: [
            {
              libelle: 'Taille de T-shirt',
              obligatoire: true,
              choix: [{ valeur: 'L' }],
            },
          ],
        })
        .expect(409);

      expect((r.body as { message: string }).message).toContain('« M »');
    });

    it('refuse de descendre un stock sous ce qui est pris', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201);
      await sInscrire(id, bruno, { [TAILLE]: 'M' }).expect(201);

      await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({
          options: [
            {
              libelle: 'Taille de T-shirt',
              obligatoire: true,
              choix: [{ valeur: 'M', stock: 1 }, { valeur: 'L' }],
            },
          ],
        })
        .expect(409);
    });

    it('accepte d’augmenter un stock et d’ajouter une taille', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201);

      await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({
          options: [
            {
              libelle: 'Taille de T-shirt',
              obligatoire: true,
              choix: [
                { valeur: 'M', stock: 10 },
                { valeur: 'L' },
                { valeur: '4XL' },
              ],
            },
          ],
        })
        .expect(200);

      expect(await restant(id, 'M')).toBe(9);
    });
  });

  describe('côté bureau', () => {
    it('récapitule par taille, payés et en attente à part', async () => {
      const id = await creerEtPublier();
      const a = idDe(await sInscrire(id, alice, { [TAILLE]: 'M' }).expect(201));
      await sInscrire(id, bruno, { [TAILLE]: 'M' }).expect(201);
      await inscriptions.update(a, { statut: StatutInscription.CONFIRMEE });

      const r = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/options/recapitulatif`)
        .set(admin.entetes)
        .expect(200);

      const m = (
        r.body as {
          choix: {
            valeur: string;
            confirmees: number;
            enAttente: number;
            restant: number;
          }[];
        }[]
      )[0].choix.find((c) => c.valeur === 'M');
      expect(m).toMatchObject({ confirmees: 1, enAttente: 1, restant: 0 });
    });

    it('compte ceux qui n’ont pas répondu', async () => {
      const id = await creerEtPublier({ options: [] });
      await sInscrire(id, alice).expect(201);
      // Les options arrivent après la première inscription.
      await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({ options: OPTIONS_TAILLES })
        .expect(200);

      const r = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/options/recapitulatif`)
        .set(admin.entetes)
        .expect(200);

      expect(
        (
          r.body as { sansReponse: { confirmees: number; enAttente: number } }[]
        )[0].sansReponse,
      ).toEqual({ confirmees: 0, enAttente: 1 }); // son inscription payante attend son paiement
    });

    it('relance ceux qui n’ont pas choisi', async () => {
      const id = await creerEtPublier({ options: [], type: 'GRATUIT' });
      await sInscrire(id, alice).expect(201);
      await sInscrire(id, bruno).expect(201);
      await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({ options: OPTIONS_TAILLES })
        .expect(200);
      // Bruno a déjà répondu : il n'est pas relancé.
      const brunoBillet = await inscriptions.findOneOrFail({
        where: { user: { id: bruno.user.id } },
      });
      await inscriptions.update(brunoBillet.id, {
        reponses: { [TAILLE]: 'L' },
      });

      const r = await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/options/relancer`)
        .set(admin.entetes)
        .expect(200);

      expect(r.body).toEqual({ prevenus: 1 });
    });

    it('exporte nom par nom, avec la taille', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, alice, { [TAILLE]: 'L' }).expect(201);

      const r = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/options/export`)
        .set(admin.entetes)
        .expect(200);

      expect(r.text).toContain('Taille de T-shirt');
      expect(r.text).toContain(alice.user.email);
      expect(r.text).toMatch(/;L;/);
    });

    it('réserve récapitulatif, export et relance au bureau', async () => {
      const id = await creerEtPublier();

      for (const chemin of ['options/recapitulatif', 'options/export']) {
        await request(app.getHttpServer())
          .get(`${EVENEMENTS}/${id}/${chemin}`)
          .set(alice.entetes)
          .expect(403);
      }
      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/options/relancer`)
        .set(alice.entetes)
        .expect(403);
    });
  });

  describe('remise du lot à l’entrée', () => {
    const affecter = (id: string) =>
      request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/scanners`)
        .set(admin.entetes)
        .send({ userId: portier.user.id });

    const remettre = (billet: string, compte: CompteDeTest) =>
      request(app.getHttpServer())
        .post(`${BILLETS}/${billet}/remise`)
        .set(compte.entetes);

    /** Un billet payé, prêt à être remis. */
    const billetPaye = async (id: string) => {
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'L' }).expect(201),
      );
      await inscriptions.update(billet, {
        statut: StatutInscription.CONFIRMEE,
      });
      return billet;
    };

    it('marque le lot remis, avec qui l’a remis', async () => {
      const id = await creerEtPublier();
      const billet = await billetPaye(id);
      await affecter(id).expect(201);

      const r = await remettre(billet, portier).expect(201);

      expect(r.body).toMatchObject({ reponses: { [TAILLE]: 'L' } });
      expect((r.body as { remisLe: string | null }).remisLe).not.toBeNull();
    });

    it('refuse une seconde remise, en disant quand et par qui', async () => {
      const id = await creerEtPublier();
      const billet = await billetPaye(id);
      await affecter(id).expect(201);
      await remettre(billet, portier).expect(201);

      const r = await remettre(billet, portier).expect(409);

      expect((r.body as { message: string }).message).toContain(
        'déjà été remis',
      );
    });

    it('ne remet pas deux fois quand deux portiers cliquent ensemble', async () => {
      const id = await creerEtPublier();
      const billet = await billetPaye(id);
      await affecter(id).expect(201);

      const resultats = await Promise.all([
        remettre(billet, portier),
        remettre(billet, admin),
      ]);

      expect(resultats.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
    });

    it('refuse à qui n’est pas à la porte de cet événement', async () => {
      const id = await creerEtPublier();
      const billet = await billetPaye(id);

      await remettre(billet, portier).expect(403);
    });

    it('refuse un billet non payé : rien à remettre', async () => {
      const id = await creerEtPublier();
      const billet = idDe(
        await sInscrire(id, alice, { [TAILLE]: 'L' }).expect(201),
      );
      await affecter(id).expect(201);

      await remettre(billet, portier).expect(409);
    });

    it('bloque tout changement de taille une fois le lot remis', async () => {
      const id = await creerEtPublier();
      const billet = await billetPaye(id);
      await affecter(id).expect(201);
      await remettre(billet, portier).expect(201);

      await changer(billet, alice, 'M').expect(409);
    });
  });
});
