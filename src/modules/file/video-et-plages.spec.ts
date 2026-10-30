import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { estCleDePagePublique, lirePlage } from './file.controller';
import { TAILLE_VIDEO_MAX, validerFichier } from './validation-fichier';

/** Un fichier dont seuls les premiers octets comptent. */
const fichier = (entete: number[], taille = 64) => {
  const buffer = Buffer.alloc(taille);
  Buffer.from(entete).copy(buffer);
  return { originalname: 'v.mp4', mimetype: 'video/mp4', buffer };
};

/** « ftyp » à l'octet 4, puis la marque. */
const mp4 = (marque = 'isom') => [
  0,
  0,
  0,
  24,
  0x66,
  0x74,
  0x79,
  0x70,
  ...Buffer.from(marque),
];

describe('vidéos d’actualité', () => {
  it('accepte un MP4 et le range dans « videos/ »', () => {
    expect(validerFichier('article-video', fichier(mp4()), Role.ADMIN)).toEqual(
      {
        prefixe: 'videos',
        mimeReel: 'video/mp4',
        proprietaire: false,
      },
    );
  });

  it('reconnaît un fichier QuickTime', () => {
    expect(
      validerFichier('article-video', fichier(mp4('qt  ')), Role.ADMIN)
        .mimeReel,
    ).toBe('video/quicktime');
  });

  it('accepte un WebM', () => {
    expect(
      validerFichier(
        'article-video',
        fichier([0x1a, 0x45, 0xdf, 0xa3]),
        Role.ADMIN,
      ).mimeReel,
    ).toBe('video/webm');
  });

  it('refuse un exécutable déguisé en vidéo', () => {
    expect(() =>
      validerFichier(
        'article-video',
        fichier([0x4d, 0x5a, 0x90, 0]),
        Role.ADMIN,
      ),
    ).toThrow(BadRequestException);
  });

  it('refuse une image sous l’usage vidéo', () => {
    expect(() =>
      validerFichier(
        'article-video',
        fichier([0x89, 0x50, 0x4e, 0x47]),
        Role.ADMIN,
      ),
    ).toThrow(BadRequestException);
  });

  it('refuse une vidéo au-delà du plafond', () => {
    expect(() =>
      validerFichier(
        'article-video',
        fichier(mp4(), TAILLE_VIDEO_MAX + 1),
        Role.ADMIN,
      ),
    ).toThrow(BadRequestException);
  });

  it('réserve les vidéos au bureau', () => {
    expect(() =>
      validerFichier('article-video', fichier(mp4()), Role.STUDENT),
    ).toThrow(ForbiddenException);
  });
});

describe('estCleDePagePublique', () => {
  it.each([
    'articles/a.png',
    'videos/v.mp4',
    'evenements/e.png',
    'produits/p.png',
    'sponsors/s.png',
    'logos/l.png',
  ])('délivre %s sans connexion', (cle) => {
    expect(estCleDePagePublique(cle)).toBe(true);
  });

  it.each([
    'justificatifs/j.png',
    'cv/cv.pdf',
    'avatars/a.png',
    'articles',
    'articles/../cv/cv.pdf',
    '',
  ])('garde %s derrière une connexion', (cle) => {
    expect(estCleDePagePublique(cle)).toBe(false);
  });

  it('refuse un paramètre répété, qui arrive en tableau', () => {
    expect(estCleDePagePublique(['articles/a.png', 'cv/cv.pdf'])).toBe(false);
    expect(estCleDePagePublique(undefined)).toBe(false);
  });
});

describe('lirePlage', () => {
  it('ne fait rien sans en-tête', () => {
    expect(lirePlage(undefined, 100)).toBeNull();
  });

  it('lit une plage fermée', () => {
    expect(lirePlage('bytes=10-19', 100)).toEqual({ debut: 10, fin: 19 });
  });

  it('lit une plage ouverte', () => {
    expect(lirePlage('bytes=90-', 100)).toEqual({ debut: 90, fin: 99 });
  });

  it('lit les derniers octets', () => {
    expect(lirePlage('bytes=-10', 100)).toEqual({ debut: 90, fin: 99 });
  });

  it('borne la fin au contenu', () => {
    expect(lirePlage('bytes=0-999', 100)).toEqual({ debut: 0, fin: 99 });
  });

  it('refuse une plage hors du contenu', () => {
    expect(lirePlage('bytes=200-300', 100)).toBe('invalide');
    expect(lirePlage('bytes=50-10', 100)).toBe('invalide');
  });

  it('ignore un en-tête illisible', () => {
    expect(lirePlage('pages=1-2', 100)).toBeNull();
    expect(lirePlage('bytes=-', 100)).toBeNull();
  });
});
