import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { FiltreExceptionGlobal } from './filtre-exception-global';
import { CodeErreur, ReponseErreur } from './reponse-erreur';

describe('FiltreExceptionGlobal', () => {
  let filtre: FiltreExceptionGlobal;
  let json: jest.Mock<void, [ReponseErreur]>;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filtre = new FiltreExceptionGlobal();
    json = jest.fn<void, [ReponseErreur]>();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/test', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost;

    // Les journaux ne sont pas l'objet du test et pollueraient la sortie.
    jest.spyOn(filtre['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filtre['logger'], 'warn').mockImplementation(() => undefined);
  });

  const corpsRenvoye = (indice = 0): ReponseErreur =>
    json.mock.calls[indice][0];

  it('donne à toute réponse la même forme', () => {
    filtre.catch(new NotFoundException('Introuvable'), host);

    const corps = corpsRenvoye();
    expect(typeof corps.code).toBe('string');
    expect(typeof corps.message).toBe('string');
    expect(corps.chemin).toBe('/api/v1/test');
    expect(typeof corps.identifiantCorrelation).toBe('string');
    // L'horodatage doit être exploitable, pas seulement présent.
    expect(new Date(corps.horodatage).toString()).not.toBe('Invalid Date');
  });

  it.each([
    [
      new UnauthorizedException(),
      HttpStatus.UNAUTHORIZED,
      CodeErreur.NON_AUTHENTIFIE,
    ],
    [new ForbiddenException(), HttpStatus.FORBIDDEN, CodeErreur.ACCES_REFUSE],
    [new NotFoundException(), HttpStatus.NOT_FOUND, CodeErreur.INTROUVABLE],
  ])(
    'traduit %# en code métier stable',
    (exception, statutAttendu, codeAttendu) => {
      filtre.catch(exception, host);

      expect(status).toHaveBeenCalledWith(statutAttendu);
      expect(corpsRenvoye().code).toBe(codeAttendu);
    },
  );

  it('regroupe les erreurs de validation par champ', () => {
    filtre.catch(
      new BadRequestException({
        message: ['email must be an email', 'motDePasse is too short'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host,
    );

    const corps = corpsRenvoye();
    expect(corps.code).toBe(CodeErreur.VALIDATION);
    expect(corps.champs).toEqual({
      email: ['email must be an email'],
      motDePasse: ['motDePasse is too short'],
    });
  });

  it('transforme une violation de contrainte unique en conflit, sans exposer le SQL', () => {
    const erreur = new QueryFailedError(
      'INSERT INTO "users" ("email") VALUES ($1)',
      ['victime@exemple.com'],
      new Error(
        'duplicate key value violates unique constraint "IDX_users_email"',
      ),
    );
    (erreur as QueryFailedError & { code?: string }).code = '23505';

    filtre.catch(erreur, host);

    const corps = corpsRenvoye();
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(corps.code).toBe(CodeErreur.CONFLIT);
    // Ni la requête, ni le nom de la contrainte, ni la valeur en cause.
    expect(JSON.stringify(corps)).not.toMatch(
      /INSERT|IDX_users_email|victime@/,
    );
  });

  it("ne laisse fuir ni message ni trace d'une exception inattendue", () => {
    const erreur = new Error(
      'Connexion refusée vers postgres://postgres:motdepasse@10.0.0.4:5432',
    );

    filtre.catch(erreur, host);

    const corps = corpsRenvoye();
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(corps.code).toBe(CodeErreur.ERREUR_INTERNE);
    expect(JSON.stringify(corps)).not.toMatch(
      /postgres|motdepasse|10\.0\.0\.4/,
    );
    // La référence permet de retrouver la trace complète côté serveur.
    expect(corps.message).toContain(corps.identifiantCorrelation);
  });

  it('donne un identifiant de corrélation différent à chaque erreur', () => {
    filtre.catch(new Error('a'), host);
    filtre.catch(new Error('b'), host);

    expect(corpsRenvoye(0).identifiantCorrelation).not.toBe(
      corpsRenvoye(1).identifiantCorrelation,
    );
  });

  it('journalise intégralement une erreur serveur, mais discrètement une erreur client', () => {
    const erreurServeur = jest.spyOn(filtre['logger'], 'error');
    const avertissement = jest.spyOn(filtre['logger'], 'warn');

    filtre.catch(new NotFoundException(), host);
    expect(avertissement).toHaveBeenCalled();
    expect(erreurServeur).not.toHaveBeenCalled();

    filtre.catch(new Error('panne'), host);
    expect(erreurServeur).toHaveBeenCalled();
  });
});
