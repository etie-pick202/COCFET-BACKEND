import { BadRequestException } from '@nestjs/common';
import {
  appartientA,
  estDansDossier,
  exigerFichierDe,
  exigerFichierDuDossier,
  segmentProprietaire,
} from './propriete-fichier';

const MOI = '6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e';
const AUTRE = '0d9e8f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';

describe('propriété des fichiers', () => {
  it('inscrit l’auteur devant le nom, et rien sans auteur', () => {
    expect(segmentProprietaire(MOI)).toBe(`${MOI}_`);
    expect(segmentProprietaire()).toBe('');
  });

  it('reconnaît un fichier rangé dans son dossier', () => {
    expect(estDansDossier('avatars/a.png', 'avatars')).toBe(true);
    expect(estDansDossier('logos/a.png', 'avatars')).toBe(false);
    expect(estDansDossier('avatars/../logos/a.png', 'avatars')).toBe(false);
    expect(estDansDossier(['avatars/a.png'], 'avatars')).toBe(false);
  });

  it('ne rattache une clé qu’à son auteur', () => {
    const cle = `avatars/${MOI}_uuid-photo.png`;

    expect(appartientA(cle, 'avatars', MOI)).toBe(true);
    expect(appartientA(cle, 'avatars', AUTRE)).toBe(false);
    expect(appartientA(cle, 'cv', MOI)).toBe(false);
    expect(appartientA('avatars/uuid-photo.png', 'avatars', MOI)).toBe(false);
  });

  describe('exigerFichierDe', () => {
    it('accepte son propre fichier, un retrait ou la valeur inchangée', () => {
      expect(() =>
        exigerFichierDe(MOI, 'avatars', `avatars/${MOI}_x.png`),
      ).not.toThrow();
      expect(() => exigerFichierDe(MOI, 'avatars', undefined)).not.toThrow();
      expect(() => exigerFichierDe(MOI, 'avatars', null)).not.toThrow();
      expect(() => exigerFichierDe(MOI, 'avatars', '')).not.toThrow();
      expect(() =>
        exigerFichierDe(
          MOI,
          'avatars',
          'avatars/ancien.png',
          'avatars/ancien.png',
        ),
      ).not.toThrow();
    });

    it('refuse le fichier d’un autre, ou d’un autre dossier', () => {
      expect(() =>
        exigerFichierDe(MOI, 'avatars', `avatars/${AUTRE}_x.png`),
      ).toThrow(BadRequestException);
      expect(() => exigerFichierDe(MOI, 'avatars', 'logos/mandat.png')).toThrow(
        BadRequestException,
      );
      expect(() => exigerFichierDe(MOI, 'avatars', `cv/${MOI}_cv.pdf`)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('exigerFichierDuDossier', () => {
    it('accepte toute clé du dossier, un retrait ou la valeur inchangée', () => {
      expect(() =>
        exigerFichierDuDossier('sponsors', `sponsors/${AUTRE}_logo.png`),
      ).not.toThrow();
      expect(() => exigerFichierDuDossier('sponsors', null)).not.toThrow();
      expect(() =>
        exigerFichierDuDossier('sponsors', 'x/y.png', 'x/y.png'),
      ).not.toThrow();
    });

    it('refuse une clé d’un autre dossier', () => {
      expect(() =>
        exigerFichierDuDossier('sponsors', `cv/${AUTRE}_cv.pdf`),
      ).toThrow(BadRequestException);
    });
  });
});
