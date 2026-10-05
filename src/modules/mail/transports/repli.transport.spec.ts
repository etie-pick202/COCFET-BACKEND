import { retirerImagesIncrustees } from './brevo-api.transport';
import { transportAvecRepli } from './repli.transport';

/**
 * Le relais SMTP porte les images ; l'API HTTP garantit que le message part.
 * Ce qui se joue ici, c'est qu'une panne du premier ne coûte jamais le second.
 */
describe('transportAvecRepli', () => {
  const envoyer = (
    principal: jest.Mock,
    repli: jest.Mock,
  ): Promise<{ erreur: Error | null; info?: { messageId: string } }> =>
    new Promise((resoudre) => {
      transportAvecRepli({
        principal: { sendMail: principal },
        repli: { send: repli },
      }).send({ data: { to: 'a@b.test' } }, (erreur, info) =>
        resoudre({ erreur, info }),
      );
    });

  it('passe par le relais SMTP quand il répond', async () => {
    const principal = jest.fn().mockResolvedValue({ messageId: '<smtp>' });
    const repli = jest.fn();

    const { erreur, info } = await envoyer(principal, repli);

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<smtp>');
    expect(repli).not.toHaveBeenCalled();
  });

  it('se rabat sur l’API quand le relais échoue', async () => {
    const principal = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const repli = jest.fn(
      (
        _mail: unknown,
        rappel: (e: Error | null, i?: { messageId: string }) => void,
      ) => rappel(null, { messageId: '<api>' }),
    );

    const { erreur, info } = await envoyer(principal, repli);

    expect(erreur).toBeNull();
    expect(info?.messageId).toBe('<api>');
    expect(repli).toHaveBeenCalledWith(
      { data: { to: 'a@b.test' } },
      expect.any(Function),
    );
  });

  it('remonte l’échec du recours', async () => {
    const principal = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const repli = jest.fn((_mail: unknown, rappel: (e: Error | null) => void) =>
      rappel(new Error('Brevo a refusé l’envoi')),
    );

    const { erreur } = await envoyer(principal, repli);

    expect(erreur?.message).toContain('Brevo a refusé');
  });
});

describe('retirerImagesIncrustees', () => {
  it('retire les images citées par cid: et garde les autres', () => {
    const html =
      '<p>a</p><img src="cid:logo@cocfet" alt="x" />' +
      '<img alt="ok" src="https://exemple.test/i.png">' +
      "<img SRC = 'cid:qr@cocfet'><p>b</p>";

    expect(retirerImagesIncrustees(html)).toBe(
      '<p>a</p><img alt="ok" src="https://exemple.test/i.png"><p>b</p>',
    );
  });

  it('laisse intact un HTML sans image', () => {
    expect(retirerImagesIncrustees('<p>rien</p>')).toBe('<p>rien</p>');
  });
});
