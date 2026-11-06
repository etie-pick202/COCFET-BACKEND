import {
  estErreurDeQuota,
  PAUSE_APRES_QUOTA_MS,
  transportEnCascade,
  voieGreffon,
  voieSmtp,
  type Voie,
} from './cascade.transport';

/**
 * Le relais SMTP porte les images ; les voies suivantes garantissent que le
 * message part. Ce qui se joue ici : qu'une panne — surtout un quota épuisé —
 * ne coûte jamais le message, ni du temps à chaque envoi.
 */
describe('transportEnCascade', () => {
  const voie = (nom: string, envoyer: jest.Mock): Voie => ({ nom, envoyer });

  const envoyer = (
    voies: Voie[],
    maintenant?: () => number,
  ): Promise<{ erreur: Error | null; info?: { messageId: string } }> =>
    new Promise((resoudre) => {
      transportEnCascade({ voies, maintenant }).send(
        { data: { to: 'a@b.test' } },
        (erreur, info) => resoudre({ erreur, info }),
      );
    });

  it('passe par la première voie quand elle répond', async () => {
    const premiere = jest.fn().mockResolvedValue({ messageId: '<smtp>' });
    const seconde = jest.fn();

    const { erreur, info } = await envoyer([
      voie('SMTP', premiere),
      voie('API', seconde),
    ]);

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<smtp>');
    expect(seconde).not.toHaveBeenCalled();
  });

  it('passe à la voie suivante quand la première échoue', async () => {
    const premiere = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const seconde = jest.fn().mockResolvedValue({ messageId: '<secours>' });

    const { erreur, info } = await envoyer([
      voie('SMTP', premiere),
      voie('Secours', seconde),
    ]);

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<secours>');
    expect(seconde).toHaveBeenCalledWith({ to: 'a@b.test' });
  });

  it('descend toute la chaîne : principal, secours, puis API', async () => {
    const principal = jest.fn().mockRejectedValue(new Error('421 timeout'));
    const secours = jest.fn().mockRejectedValue(new Error('535 refusé'));
    const api = jest.fn().mockResolvedValue({ messageId: '<api>' });

    const { erreur, info } = await envoyer([
      voie('SMTP', principal),
      voie('Secours', secours),
      voie('API', api),
    ]);

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<api>');
  });

  it('remonte l’échec de toutes les voies, en les nommant', async () => {
    const { erreur } = await envoyer([
      voie('SMTP', jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))),
      voie('API', jest.fn().mockRejectedValue(new Error('Brevo a refusé'))),
    ]);

    expect(erreur?.message).toContain('SMTP : ECONNREFUSED');
    expect(erreur?.message).toContain('API : Brevo a refusé');
  });

  describe('quota épuisé', () => {
    const QUOTA = new Error('Daily sending limit exceeded');

    const expedier = (transport: ReturnType<typeof transportEnCascade>) =>
      new Promise<{ erreur: Error | null }>((resoudre) =>
        transport.send({ data: {} }, (erreur) => resoudre({ erreur })),
      );

    it('laisse la voie de côté, puis la retente passé le délai', async () => {
      let heure = 1_000;
      const premiere = jest.fn().mockRejectedValue(QUOTA);
      const seconde = jest.fn().mockResolvedValue({ messageId: '<2>' });
      const voies = [voie('SMTP', premiere), voie('Secours', seconde)];
      const transport = transportEnCascade({ voies, maintenant: () => heure });
      const envoi = () => expedier(transport);

      await envoi();
      expect(premiere).toHaveBeenCalledTimes(1);

      // Pendant la pause, la première voie n'est même pas tentée.
      heure += PAUSE_APRES_QUOTA_MS - 1;
      await envoi();
      expect(premiere).toHaveBeenCalledTimes(1);
      expect(seconde).toHaveBeenCalledTimes(2);

      // La pause écoulée, elle est retentée : le quota a pu se renouveler.
      heure += 2;
      await envoi();
      expect(premiere).toHaveBeenCalledTimes(2);
    });

    it('ne met rien de côté pour un échec passager', async () => {
      const premiere = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
      const seconde = jest.fn().mockResolvedValue({ messageId: '<2>' });
      const transport = transportEnCascade({
        voies: [voie('SMTP', premiere), voie('Secours', seconde)],
      });
      const envoi = () => expedier(transport);

      await envoi();
      await envoi();

      expect(premiere).toHaveBeenCalledTimes(2);
    });

    it('essaie quand même quand toutes les voies sont en pause', async () => {
      const seule = jest
        .fn()
        .mockRejectedValueOnce(QUOTA)
        .mockResolvedValue({ messageId: '<ok>' });
      const transport = transportEnCascade({ voies: [voie('SMTP', seule)] });
      const envoi = () => expedier(transport);

      expect((await envoi()).erreur).not.toBeNull();
      // Mise de côté, mais seule : mieux vaut réessayer que ne plus rien envoyer.
      expect((await envoi()).erreur).toBeNull();
    });
  });
});

describe('estErreurDeQuota', () => {
  it.each([
    'Daily sending limit exceeded',
    '550 5.4.5 Quota exceeded',
    'You have run out of credits',
    "Brevo a refusé l'envoi (HTTP 402) : account not activated",
    "Brevo a refusé l'envoi (HTTP 429) : too many requests",
    'Rate limit reached',
  ])('reconnaît « %s »', (message) => {
    expect(estErreurDeQuota(new Error(message))).toBe(true);
  });

  it.each([
    'ETIMEDOUT',
    '535 Authentication failed',
    'Greeting never received',
    "Brevo n'a pas répondu en moins de 10000 ms : envoi abandonné.",
  ])('ne prend pas « %s » pour un quota', (message) => {
    expect(estErreurDeQuota(new Error(message))).toBe(false);
  });

  it('lit aussi la réponse du serveur SMTP', () => {
    const erreur = Object.assign(new Error('Message failed'), {
      response: '452 4.5.3 Too many recipients — quota',
    });

    expect(estErreurDeQuota(erreur)).toBe(true);
  });
});

describe('voies', () => {
  it('voieSmtp impose l’expéditeur propre à la voie, sans toucher au reste', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<1>' });

    await voieSmtp(
      'Secours',
      { sendMail },
      'COCFET <relais@exemple.test>',
    ).envoyer({
      from: 'COCFET <contact@cocfet-ucac-icam.com>',
      to: 'a@b.test',
      subject: 'Bonjour',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'COCFET <relais@exemple.test>',
      to: 'a@b.test',
      subject: 'Bonjour',
    });
  });

  it('voieSmtp garde l’expéditeur du message sans expéditeur de secours', async () => {
    const sendMail = jest.fn().mockResolvedValue({});

    await voieSmtp('SMTP', { sendMail }).envoyer({ from: 'x@y.test' });

    expect(sendMail).toHaveBeenCalledWith({ from: 'x@y.test' });
  });

  it('voieGreffon rend le résultat du greffon, ou son erreur', async () => {
    const bon = voieGreffon('API', {
      send: (_mail, rappel) => rappel(null, { messageId: '<api>' }),
    });
    await expect(bon.envoyer({})).resolves.toEqual({ messageId: '<api>' });

    const mauvais = voieGreffon('API', {
      send: (_mail, rappel) => rappel(new Error('refusé')),
    });
    await expect(mauvais.envoyer({})).rejects.toThrow('refusé');
  });
});
