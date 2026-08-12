import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { Usage, USAGES, validerFichier } from './validation-fichier';

/** Role par defaut des tests de format : il a droit a tous les usages. */
const ADMIN = Role.ADMIN;

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
      expect(validerFichier('avatar', fichier(octets), ADMIN)).toEqual({
        prefixe: 'avatars',
        mimeReel: attendu,
      });
    });

    it('accepte un webp', () => {
      expect(validerFichier('avatar', webp(), ADMIN).mimeReel).toBe(
        'image/webp',
      );
    });

    it('accepte un pdf pour un CV', () => {
      expect(validerFichier('cv', fichier(ENTETES.pdf), ADMIN).mimeReel).toBe(
        'application/pdf',
      );
    });
  });

  describe('logo du mandat', () => {
    // Le logo n'est pas qu'affiché : il est incrusté dans les factures et les
    // reçus, et PDFKit ne sait poser que du PNG et du JPEG. Un format accepté
    // ici mais impossible à incruster produirait des documents sans logo,
    // dégradés en silence — donc découverts par le destinataire.
    it.each([
      ['png', ENTETES.png],
      ['jpeg', ENTETES.jpeg],
    ])('accepte un %s', (_nom, octets) => {
      expect(() =>
        validerFichier('logo', fichier(octets), ADMIN),
      ).not.toThrow();
    });

    it('refuse un gif, pourtant une image valide', () => {
      expect(() => validerFichier('logo', fichier(ENTETES.gif), ADMIN)).toThrow(
        BadRequestException,
      );
    });

    it('refuse un webp, pourtant une image valide', () => {
      expect(() => validerFichier('logo', webp(), ADMIN)).toThrow(
        BadRequestException,
      );
    });

    it('dit quel format est attendu plutôt que de refuser sans motif', () => {
      // Le bureau doit comprendre qu'il lui suffit de convertir son fichier.
      expect(() => validerFichier('logo', webp(), ADMIN)).toThrow(
        /image\/png ou image\/jpeg/,
      );
    });

    it('laisse les autres visuels accepter le webp', () => {
      // La restriction vise le logo seul : elle n'a pas de raison de peser sur
      // une image de couverture, qui n'entre dans aucun PDF.
      expect(() => validerFichier('evenement', webp(), ADMIN)).not.toThrow();
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
          ADMIN,
        ),
      ).toThrow(BadRequestException);
    });

    it('refuse une archive déguisée en image', () => {
      expect(() =>
        validerFichier(
          'produit',
          fichier(ENTETES.zip, { nom: 'visuel.jpg' }),
          ADMIN,
        ),
      ).toThrow(BadRequestException);
    });

    it('refuse un RIFF qui n’est pas du webp', () => {
      // RIFF couvre aussi WAV et AVI : la signature de tête ne suffit pas.
      const buffer = Buffer.alloc(64);
      buffer.write('RIFF', 0);
      buffer.write('WAVE', 8);

      expect(() =>
        validerFichier(
          'avatar',
          {
            originalname: 'son.webp',
            mimetype: 'image/webp',
            buffer,
          },
          ADMIN,
        ),
      ).toThrow(BadRequestException);
    });

    it('refuse un pdf là où une image est attendue', () => {
      expect(() =>
        validerFichier('avatar', fichier(ENTETES.pdf), ADMIN),
      ).toThrow(BadRequestException);
    });

    it('refuse une image là où un pdf est attendu', () => {
      expect(() => validerFichier('cv', fichier(ENTETES.png), ADMIN)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('taille et usage', () => {
    it('refuse un fichier vide', () => {
      expect(() =>
        validerFichier(
          'avatar',
          {
            originalname: 'vide.png',
            mimetype: 'image/png',
            buffer: Buffer.alloc(0),
          },
          ADMIN,
        ),
      ).toThrow(/vide/);
    });

    it('applique la limite propre à chaque usage', () => {
      // 3 Mo passent pour un visuel d'événement, pas pour un avatar.
      const gros = fichier(ENTETES.png, { taille: 3 * 1024 * 1024 });

      expect(() => validerFichier('avatar', gros, ADMIN)).toThrow(/2 Mo/);
      expect(() => validerFichier('evenement', gros, ADMIN)).not.toThrow();
    });

    it('refuse un usage inconnu plutôt que de deviner un dossier', () => {
      // Un préfixe libre permettrait de déposer un CV parmi les logos.
      expect(() =>
        validerFichier('../public' as Usage, fichier(ENTETES.png), ADMIN),
      ).toThrow(BadRequestException);
    });

    it('range chaque usage dans son propre dossier', () => {
      const prefixes = Object.keys(USAGES).map(
        (usage) =>
          validerFichier(
            usage as Usage,
            usage === 'cv' ? fichier(ENTETES.pdf) : fichier(ENTETES.png),
            ADMIN,
          ).prefixe,
      );

      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });

  describe('droits par usage', () => {
    it('reserve le CV aux etudiants', () => {
      // L'annuaire des finissants est ce que consultent les entreprises : un
      // CV depose par un visiteur externe n'y a pas sa place.
      expect(() =>
        validerFichier('cv', fichier(ENTETES.pdf), Role.STUDENT),
      ).not.toThrow();

      expect(() =>
        validerFichier('cv', fichier(ENTETES.pdf), Role.VISITOR),
      ).toThrow(ForbiddenException);

      expect(() =>
        validerFichier('cv', fichier(ENTETES.pdf), Role.SPONSOR),
      ).toThrow(ForbiddenException);
    });

    it('laisse tout compte deposer sa propre photo', () => {
      for (const role of Object.values(Role)) {
        expect(() =>
          validerFichier('avatar', fichier(ENTETES.png), role),
        ).not.toThrow();
      }
    });

    it('reserve les visuels du site au bureau', () => {
      for (const usage of ['evenement', 'produit', 'article'] as const) {
        expect(() =>
          validerFichier(usage, fichier(ENTETES.png), Role.STUDENT),
        ).toThrow(ForbiddenException);
        expect(() =>
          validerFichier(usage, fichier(ENTETES.png), Role.ADMIN),
        ).not.toThrow();
      }
    });

    it('laisse le partenaire deposer son logo, et le bureau le faire pour lui', () => {
      expect(() =>
        validerFichier('sponsor', fichier(ENTETES.png), Role.SPONSOR),
      ).not.toThrow();
      expect(() =>
        validerFichier('sponsor', fichier(ENTETES.png), Role.ADMIN),
      ).not.toThrow();
      expect(() =>
        validerFichier('sponsor', fichier(ENTETES.png), Role.STUDENT),
      ).toThrow(ForbiddenException);
    });

    it('reserve le logo du mandat au bureau', () => {
      expect(() =>
        validerFichier('logo', fichier(ENTETES.png), Role.ADMIN),
      ).not.toThrow();
      expect(() =>
        validerFichier('logo', fichier(ENTETES.png), Role.STUDENT),
      ).toThrow(ForbiddenException);
    });

    it('verifie le droit avant le format', () => {
      // Un refus de droit ne doit pas dependre du contenu envoye : sinon un
      // message d'erreur different revelerait quels usages existent.
      expect(() =>
        validerFichier('cv', fichier(ENTETES.png), Role.VISITOR),
      ).toThrow(ForbiddenException);
    });
  });
});
