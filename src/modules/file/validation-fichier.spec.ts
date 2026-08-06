import { BadRequestException } from '@nestjs/common';
import { Usage, USAGES, validerFichier } from './validation-fichier';

/** Premiers octets réels de chaque format, suivis d'un remplissage. */
const ENTETES = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37],
  elf: [0x7f, 0x45, 0x4c, 0x46],
  zip: [0x50, 0x4b, 0x03, 0x04],
};

const fichier = (
  octets: number[],
  options: { nom?: string; mime?: string; taille?: number } = {},
) => {
  const buffer = Buffer.alloc(options.taille ?? 64);
  Buffer.from(octets).copy(buffer);
  return {
    originalname: options.nom ?? 'fichier.png',
    mimetype: options.mime ?? 'image/png',
    buffer,
  };
};

const webp = () => {
  const buffer = Buffer.alloc(64);
  buffer.write('RIFF', 0);
  buffer.write('WEBP', 8);
  return { originalname: 'image.webp', mimetype: 'image/webp', buffer };
};

describe('validerFichier', () => {
  describe('formats acceptés', () => {
    it.each([
      ['png', ENTETES.png, 'image/png'],
      ['jpeg', ENTETES.jpeg, 'image/jpeg'],
      ['gif', ENTETES.gif, 'image/gif'],
    ])('accepte un %s et en déduit le type réel', (_nom, octets, attendu) => {
      expect(validerFichier('avatar', fichier(octets))).toEqual({
        prefixe: 'avatars',
        mimeReel: attendu,
      });
    });

    it('accepte un webp', () => {
      expect(validerFichier('avatar', webp()).mimeReel).toBe('image/webp');
    });

    it('accepte un pdf pour un CV', () => {
      expect(validerFichier('cv', fichier(ENTETES.pdf)).mimeReel).toBe(
        'application/pdf',
      );
    });
  });

  describe('contenu déguisé', () => {
    it('refuse un exécutable renommé et déclaré image/png', () => {
      // Le scénario que le champ `mimetype` seul ne voit pas : il est fourni
      // par le client, qui annonce ce qu'il veut.
      expect(() =>
        validerFichier(
          'avatar',
          fichier(ENTETES.elf, { nom: 'photo.png', mime: 'image/png' }),
        ),
      ).toThrow(BadRequestException);
    });

    it('refuse une archive déguisée en image', () => {
      expect(() =>
        validerFichier('produit', fichier(ENTETES.zip, { nom: 'visuel.jpg' })),
      ).toThrow(BadRequestException);
    });

    it('refuse un RIFF qui n’est pas du webp', () => {
      // RIFF couvre aussi WAV et AVI : la signature de tête ne suffit pas.
      const buffer = Buffer.alloc(64);
      buffer.write('RIFF', 0);
      buffer.write('WAVE', 8);

      expect(() =>
        validerFichier('avatar', {
          originalname: 'son.webp',
          mimetype: 'image/webp',
          buffer,
        }),
      ).toThrow(BadRequestException);
    });

    it('refuse un pdf là où une image est attendue', () => {
      expect(() => validerFichier('avatar', fichier(ENTETES.pdf))).toThrow(
        BadRequestException,
      );
    });

    it('refuse une image là où un pdf est attendu', () => {
      expect(() => validerFichier('cv', fichier(ENTETES.png))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('taille et usage', () => {
    it('refuse un fichier vide', () => {
      expect(() =>
        validerFichier('avatar', {
          originalname: 'vide.png',
          mimetype: 'image/png',
          buffer: Buffer.alloc(0),
        }),
      ).toThrow(/vide/);
    });

    it('applique la limite propre à chaque usage', () => {
      // 3 Mo passent pour un visuel d'événement, pas pour un avatar.
      const gros = fichier(ENTETES.png, { taille: 3 * 1024 * 1024 });

      expect(() => validerFichier('avatar', gros)).toThrow(/2 Mo/);
      expect(() => validerFichier('evenement', gros)).not.toThrow();
    });

    it('refuse un usage inconnu plutôt que de deviner un dossier', () => {
      // Un préfixe libre permettrait de déposer un CV parmi les logos.
      expect(() =>
        validerFichier('../public' as Usage, fichier(ENTETES.png)),
      ).toThrow(BadRequestException);
    });

    it('range chaque usage dans son propre dossier', () => {
      const prefixes = Object.keys(USAGES).map(
        (usage) =>
          validerFichier(
            usage as Usage,
            usage === 'cv' ? fichier(ENTETES.pdf) : fichier(ENTETES.png),
          ).prefixe,
      );

      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });
});
