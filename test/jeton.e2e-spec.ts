import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import {
  JetonAuth,
  TypeJeton,
} from './../src/modules/auth/entities/jeton-auth.entity';
import { JetonService } from './../src/modules/auth/jeton.service';
import { User } from './../src/modules/user/entities/user.entity';

/**
 * Ces garanties ne peuvent pas être vérifiées avec un dépôt simulé : elles
 * reposent sur le comportement réel de la base. Un critère TypeORM mal formé
 * peut n'affecter aucune ligne sans lever d'erreur — le jeton reste alors
 * indéfiniment réutilisable, alors que le code semble correct.
 */
describe('JetonService (e2e)', () => {
  let module: TestingModule;
  let service: JetonService;
  let users: Repository<User>;
  let jetons: Repository<JetonAuth>;
  let user: User;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();

    service = module.get(JetonService);
    users = module.get(getRepositoryToken(User));
    jetons = module.get(getRepositoryToken(JetonAuth));
  });

  beforeEach(async () => {
    await jetons.clear();
    await users.createQueryBuilder().delete().execute();
    user = await users.save(
      users.create({
        email: 'porteur.jeton@gmail.com',
        firstName: 'Porteur',
        lastName: 'Jeton',
      }),
    );
  });

  afterAll(async () => {
    await jetons.clear();
    await users.createQueryBuilder().delete().execute();
    await module.close();
  });

  it('ne stocke jamais le jeton en clair', async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    const enBase = await jetons.findOneOrFail({
      where: { type: TypeJeton.VERIFICATION_EMAIL },
    });

    expect(enBase.empreinte).not.toBe(valeur);
    expect(enBase.empreinte).toBe(
      createHash('sha256').update(valeur).digest('hex'),
    );
  });

  it('accepte un jeton valide', async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    const resultat = await service.consommer(
      valeur,
      TypeJeton.VERIFICATION_EMAIL,
    );

    expect(resultat?.id).toBe(user.id);
  });

  it('refuse le second usage du même jeton', async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    await service.consommer(valeur, TypeJeton.VERIFICATION_EMAIL);
    const second = await service.consommer(
      valeur,
      TypeJeton.VERIFICATION_EMAIL,
    );

    expect(second).toBeNull();
  });

  it("ne sert qu'une seule requête parmi plusieurs simultanées", async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    const resultats = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.consommer(valeur, TypeJeton.VERIFICATION_EMAIL),
      ),
    );

    // Sans la condition « consomme_le IS NULL » dans l'UPDATE, plusieurs
    // requêtes concurrentes réussiraient et l'usage unique ne tiendrait pas.
    expect(resultats.filter((r) => r !== null)).toHaveLength(1);
  });

  it('invalide les jetons précédents du même type', async () => {
    const premier = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);
    await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    // Redemander un lien doit rendre le précédent inutilisable, sinon chaque
    // demande laisserait un lien valide de plus dans la nature.
    expect(
      await service.consommer(premier, TypeJeton.VERIFICATION_EMAIL),
    ).toBeNull();
  });

  it("n'invalide pas les jetons d'un autre type", async () => {
    const reinitialisation = await service.emettre(
      user,
      TypeJeton.REINITIALISATION_MOT_DE_PASSE,
    );
    await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    expect(
      await service.consommer(
        reinitialisation,
        TypeJeton.REINITIALISATION_MOT_DE_PASSE,
      ),
    ).not.toBeNull();
  });

  it('refuse un jeton présenté sur le mauvais parcours', async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    // Un lien de vérification ne doit pas permettre de changer un mot de passe.
    expect(
      await service.consommer(valeur, TypeJeton.REINITIALISATION_MOT_DE_PASSE),
    ).toBeNull();
  });

  it('refuse un jeton expiré', async () => {
    const valeur = await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);
    await jetons
      .createQueryBuilder()
      .update(JetonAuth)
      .set({ expireLe: new Date(Date.now() - 1000) })
      .where('1 = 1')
      .execute();

    expect(
      await service.consommer(valeur, TypeJeton.VERIFICATION_EMAIL),
    ).toBeNull();
  });

  it('refuse une valeur inventée', async () => {
    await service.emettre(user, TypeJeton.VERIFICATION_EMAIL);

    expect(
      await service.consommer('jeton-invente', TypeJeton.VERIFICATION_EMAIL),
    ).toBeNull();
  });
});
