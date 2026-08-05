import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { MailService } from './../src/modules/mail/mail.service';
import { Evenement } from './../src/modules/evenement/entities/evenement.entity';
import {
  Notification,
  TypeNotification,
} from './../src/modules/notification/entities/notification.entity';
import {
  CanalRappel,
  Rappel,
} from './../src/modules/notification/entities/rappel.entity';
import { RappelService } from './../src/modules/notification/rappel.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

/**
 * Rappels programmés avant un événement.
 *
 * Le point délicat est l'idempotence : un rappel ne doit jamais partir deux
 * fois, y compris si le processus redémarre en plein traitement ou si deux
 * instances tournent en parallèle.
 */
describe('Rappels (e2e)', () => {
  let app: INestApplication<App>;
  let service: RappelService;
  let rappels: Repository<Rappel>;
  let evenements: Repository<Evenement>;
  let notifications: Repository<Notification>;
  let evenement: Evenement;
  let alice: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const programmer = (user: User, dateRappel: Date, isSent = false) =>
    rappels.save(
      rappels.create({
        user,
        evenement,
        dateRappel,
        canaux: [CanalRappel.PUSH],
        isSent,
      }),
    );

  const ilYA = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const dans = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    service = app.get(RappelService);
    rappels = app.get(getRepositoryToken(Rappel));
    evenements = app.get(getRepositoryToken(Evenement));
    notifications = app.get(getRepositoryToken(Notification));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await rappels.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    alice = await creerCompteAuthentifie(app, { prenom: 'Alice' });
    evenement = await evenements.save(
      evenements.create({
        titre: 'Gala des finissants',
        description: 'Soirée de clôture.',
        dateDebut: dans(60 * 24),
        lieu: 'Campus UCAC-ICAM',
      }),
    );
  });

  afterAll(async () => {
    await rappels.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  it('envoie un rappel échu et crée la notification correspondante', async () => {
    await programmer(alice.user, ilYA(1));

    await expect(service.envoyerLesRappelsDus()).resolves.toBe(1);

    const creees = await notifications.find();
    expect(creees).toHaveLength(1);
    expect(creees[0]).toMatchObject({ type: TypeNotification.RAPPEL });
    expect(creees[0].titre).toContain('Gala des finissants');
    expect(creees[0].lien).toBe(`/evenements/${evenement.id}`);
  });

  it('ne renvoie jamais un rappel déjà parti', async () => {
    // La garantie centrale : le second passage de la tâche planifiée, une
    // minute plus tard, ne doit rien réexpédier.
    await programmer(alice.user, ilYA(1));

    await service.envoyerLesRappelsDus();
    await expect(service.envoyerLesRappelsDus()).resolves.toBe(0);
    await expect(notifications.count()).resolves.toBe(1);
  });

  it('laisse les rappels futurs intacts', async () => {
    await programmer(alice.user, dans(30));

    await expect(service.envoyerLesRappelsDus()).resolves.toBe(0);
    await expect(rappels.countBy({ isSent: false })).resolves.toBe(1);
  });

  it('marque comme envoyé avant d’envoyer', async () => {
    // Si le processus meurt au milieu, le pire est un rappel manqué. L'ordre
    // inverse renverrait tout à chacun au redémarrage, et deux instances
    // traiteraient la même liste.
    const rappel = await programmer(alice.user, ilYA(5));

    await service.envoyerLesRappelsDus();

    await expect(
      rappels.findOne({ where: { id: rappel.id } }),
    ).resolves.toMatchObject({ isSent: true });
  });

  it('traite plusieurs destinataires en une passe', async () => {
    const bob = await creerCompteAuthentifie(app, { prenom: 'Bob' });
    await programmer(alice.user, ilYA(2));
    await programmer(bob.user, ilYA(3));

    await expect(service.envoyerLesRappelsDus()).resolves.toBe(2);
    await expect(notifications.count()).resolves.toBe(2);
  });

  it('ne traite que ce qui est échu quand les deux coexistent', async () => {
    await programmer(alice.user, ilYA(1));
    await programmer(alice.user, dans(120));

    await expect(service.envoyerLesRappelsDus()).resolves.toBe(1);
    await expect(rappels.countBy({ isSent: false })).resolves.toBe(1);
  });

  it('disparaît avec l’événement supprimé', async () => {
    // La cascade évite qu'un rappel orphelin fasse échouer la tâche planifiée
    // toutes les minutes en tentant de lire un événement inexistant.
    await programmer(alice.user, dans(60));
    await evenements.delete(evenement.id);

    await expect(rappels.count()).resolves.toBe(0);
    await expect(service.envoyerLesRappelsDus()).resolves.toBe(0);
  });
});
