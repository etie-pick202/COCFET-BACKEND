import * as jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { enUrlDeDonnees, genererQrBillet } from './qr-billet';

/** Relit l'image comme le ferait un lecteur à l'entrée. */
function decoder(png: Buffer): string | null {
  const image = PNG.sync.read(png);

  return (
    jsQR.default(Uint8ClampedArray.from(image.data), image.width, image.height)
      ?.data ?? null
  );
}

/**
 * Le rendu PNG est lent sous Jest, et seulement sous Jest : une génération y
 * coûte environ 4,4 s, contre 67 ms lancée directement sous Node — le même
 * appel, la même image. Le surcoût vient de l'environnement de test, non du
 * code éprouvé, et le délai par défaut de 5 s ne laisse pas la place à deux
 * générations dans un même cas.
 */
jest.setTimeout(30_000);

describe('genererQrBillet', () => {
  const CODE = 'COCFET-A1B2C3D4E5F6';

  it('produit une image relisible portant le code du billet', async () => {
    // Le critère qui compte : ce qui sort doit se décoder. Vérifier seulement
    // que la fonction renvoie des octets laisserait passer un QR illisible.
    expect(decoder(await genererQrBillet(CODE))).toBe(CODE);
  });

  it('n’encode que le code, aucune donnée personnelle', async () => {
    const decode = decoder(await genererQrBillet(CODE));

    // Un billet se photographie et se transfère : tout ce qui est encodé
    // devient lisible par quiconque pointe un téléphone dessus.
    expect(decode).toBe(CODE);
    expect(decode).not.toMatch(/@/);
  });

  it('redonne la même image pour le même code', async () => {
    // Ce qui rend le renvoi anodin : rien n'est stocké ni à retrouver, le QR
    // se reconstruit à l'identique depuis le code.
    // Séquentiel à dessein : c'est le déterminisme qui est éprouvé ici, et le
    // rendu PNG de `qrcode` ne rend pas la main sous l'environnement Jest
    // lorsque deux générations sont lancées de front — sans que cela se
    // reproduise à l'exécution réelle, vérifiée hors Jest.
    const un = await genererQrBillet(CODE);
    const deux = await genererQrBillet(CODE);

    expect(un.equals(deux)).toBe(true);
  });

  it('distingue deux billets', async () => {
    const autre = await genererQrBillet('COCFET-0F0E0D0C0B0A');

    expect(decoder(autre)).not.toBe(CODE);
  });

  it('emballe le PNG en URL de données affichable', () => {
    const url = enUrlDeDonnees(Buffer.from('image'));

    expect(url).toBe(
      `data:image/png;base64,${Buffer.from('image').toString('base64')}`,
    );
  });
});
