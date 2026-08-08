import { transportBrevoApi } from './brevo-api.transport';

interface CorpsBrevo {
  sender: { email: string; name?: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent?: string;
  textContent?: string;
  attachment?: { name: string; content: string }[];
}

/**
 * Le transport est la seule pièce qui parle à Brevo. Une erreur de traduction
 * ici ne se voit pas au typage — elle se voit à un mail qui ne part pas, et
 * l'expérience montre que ça peut rester invisible plusieurs jours.
 */
describe('transportBrevoApi', () => {
  const reponseOk = (charge: unknown = { messageId: '<abc@brevo>' }) =>
    ({
      ok: true,
      status: 201,
      json: () => Promise.resolve(charge),
      text: () => Promise.resolve(''),
    }) as unknown as Response;

  const envoyer = (donnees: Record<string, unknown>, appel: jest.Mock) =>
    new Promise<{ erreur: Error | null; info?: { messageId: string } }>(
      (resoudre) => {
        transportBrevoApi({
          cleApi: 'cle-de-test',
          fetchImpl: appel,
        }).send({ data: donnees }, (erreur, info) =>
          resoudre({ erreur, info }),
        );
      },
    );

  const requete = (appel: jest.Mock) =>
    appel.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];

  const corpsEnvoye = (appel: jest.Mock): CorpsBrevo =>
    JSON.parse(requete(appel)[1].body) as CorpsBrevo;

  it('traduit un message rendu en charge utile Brevo', async () => {
    const appel = jest.fn().mockResolvedValue(reponseOk());

    const { erreur, info } = await envoyer(
      {
        from: 'COCFET <no-reply@cocfet.com>',
        to: 'etienne@example.com',
        subject: 'Confirmez votre adresse',
        html: '<p>Bonjour</p>',
      },
      appel,
    );

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<abc@brevo>');

    const [url, options] = requete(appel);
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('cle-de-test');

    expect(corpsEnvoye(appel)).toMatchObject({
      sender: { name: 'COCFET', email: 'no-reply@cocfet.com' },
      to: [{ email: 'etienne@example.com' }],
      subject: 'Confirmez votre adresse',
      htmlContent: '<p>Bonjour</p>',
    });
  });

  it('accepte les formes d’adresse produites par nodemailer', async () => {
    const appel = jest.fn().mockResolvedValue(reponseOk());

    await envoyer(
      {
        from: { name: 'COCFET', address: 'no-reply@cocfet.com' },
        to: ['un@example.com, deux@example.com', { address: 'trois@x.com' }],
        subject: 'Sujet',
        html: '<p>x</p>',
      },
      appel,
    );

    expect(corpsEnvoye(appel).to).toEqual([
      { email: 'un@example.com' },
      { email: 'deux@example.com' },
      { email: 'trois@x.com' },
    ]);
  });

  it('encode la pièce jointe du billet en base64', async () => {
    const appel = jest.fn().mockResolvedValue(reponseOk());

    await envoyer(
      {
        from: 'a@b.com',
        to: 'c@d.com',
        subject: 'Votre billet',
        html: '<p>billet</p>',
        attachments: [
          { filename: 'billet-XYZ.png', content: Buffer.from('image-png') },
        ],
      },
      appel,
    );

    expect(corpsEnvoye(appel).attachment).toEqual([
      {
        name: 'billet-XYZ.png',
        content: Buffer.from('image-png').toString('base64'),
      },
    ]);
  });

  /**
   * Le motif exact vient du corps de la réponse : expéditeur non validé, clé
   * refusée, quota dépassé. Le perdre renverrait au diagnostic à l'aveugle.
   */
  it('remonte le motif exact d’un refus de Brevo', async () => {
    const appel = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve('{"message":"Sender email is not valid","code":"x"}'),
      json: () => Promise.resolve({}),
    });

    const { erreur } = await envoyer(
      { from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>x</p>' },
      appel,
    );

    expect(erreur?.message).toContain('HTTP 400');
    expect(erreur?.message).toContain('Sender email is not valid');
  });

  it('abandonne au bout du délai au lieu de rester pendu', async () => {
    const expiration = Object.assign(new Error('The operation timed out'), {
      name: 'TimeoutError',
    });
    const appel = jest.fn().mockRejectedValue(expiration);

    const { erreur } = await envoyer(
      { from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>x</p>' },
      appel,
    );

    expect(erreur?.message).toMatch(/n'a pas répondu en moins de \d+ ms/);
  });

  it('refuse un message sans destinataire lisible', async () => {
    const appel = jest.fn();

    const { erreur } = await envoyer(
      { from: 'a@b.com', to: undefined, subject: 's' },
      appel,
    );

    expect(erreur?.message).toContain('Aucun destinataire');
    expect(appel).not.toHaveBeenCalled();
  });

  it('refuse un message sans expéditeur', async () => {
    const appel = jest.fn();

    const { erreur } = await envoyer({ to: 'c@d.com', subject: 's' }, appel);

    expect(erreur?.message).toContain('MAIL_FROM');
    expect(appel).not.toHaveBeenCalled();
  });
});
