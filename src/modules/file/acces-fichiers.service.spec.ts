import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AccesFichiers } from './acces-fichiers.service';

const MOI = '6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e';
const AUTRE = '0d9e8f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';

function creer({ references = [] as unknown[], tresorerie = false } = {}) {
  const query = jest.fn().mockResolvedValue(references);
  const privilegesDe = jest
    .fn()
    .mockResolvedValue({ accedeTresorerie: tresorerie });
  const acces = new AccesFichiers(
    { query } as unknown as DataSource,
    { get: () => ({ privilegesDe }) } as unknown as ModuleRef,
  );
  return { acces, query, privilegesDe };
}

const etudiant = { id: MOI, role: Role.STUDENT };

describe('AccesFichiers', () => {
  it('ouvre les médias de pages publiques à tous', async () => {
    const { acces } = creer();

    await expect(acces.peutLire('logos/mandat.png')).resolves.toBe(true);
    await expect(acces.peutLire('evenements/a.png')).resolves.toBe(true);
  });

  it('ferme tout le reste aux visiteurs non connectés', async () => {
    const { acces } = creer();

    await expect(acces.peutLire('avatars/a.png')).resolves.toBe(false);
    await expect(acces.peutLire('cv/a.pdf')).resolves.toBe(false);
  });

  it('ouvre les photos et visuels de sondage à tout membre', async () => {
    const { acces } = creer();

    await expect(acces.peutLire('avatars/a.png', etudiant)).resolves.toBe(true);
    await expect(acces.peutLire('sondages/a.png', etudiant)).resolves.toBe(
      true,
    );
  });

  describe('CV', () => {
    it('le livre à son auteur et à l’administration', async () => {
      const { acces } = creer();

      await expect(acces.peutLire(`cv/${MOI}_cv.pdf`, etudiant)).resolves.toBe(
        true,
      );
      await expect(
        acces.peutLire(`cv/${AUTRE}_cv.pdf`, { id: MOI, role: Role.ADMIN }),
      ).resolves.toBe(true);
    });

    it('le refuse à un autre membre et à un partenaire', async () => {
      const { acces } = creer();

      await expect(
        acces.peutLire(`cv/${AUTRE}_cv.pdf`, etudiant),
      ).resolves.toBe(false);
      await expect(
        acces.peutLire(`cv/${AUTRE}_cv.pdf`, { id: MOI, role: Role.SPONSOR }),
      ).resolves.toBe(false);
    });

    it('reconnaît un CV déposé avant que les clés portent leur auteur', async () => {
      const { acces, query } = creer({ references: [{}] });

      await expect(acces.peutLire('cv/ancien.pdf', etudiant)).resolves.toBe(
        true,
      );
      expect(query).toHaveBeenCalledWith(expect.stringContaining('cv_url'), [
        'cv/ancien.pdf',
        MOI,
      ]);
    });
  });

  describe('justificatifs', () => {
    it('le livre à son auteur', async () => {
      const { acces } = creer();

      await expect(
        acces.peutLire(`justificatifs/${MOI}_j.png`, etudiant),
      ).resolves.toBe(true);
    });

    it('le livre à la trésorerie, pas au reste du bureau', async () => {
      const admin = { id: MOI, role: Role.ADMIN };

      await expect(
        creer({ tresorerie: true }).acces.peutLire(
          `justificatifs/${AUTRE}_j.png`,
          admin,
        ),
      ).resolves.toBe(true);
      await expect(
        creer().acces.peutLire(`justificatifs/${AUTRE}_j.png`, admin),
      ).resolves.toBe(false);
    });
  });

  it('réserve les autres dossiers à l’administration', async () => {
    const { acces } = creer();

    await expect(acces.peutLire('documents/f.pdf', etudiant)).resolves.toBe(
      false,
    );
    await expect(
      acces.peutLire('documents/f.pdf', { id: MOI, role: Role.ADMIN }),
    ).resolves.toBe(true);
  });

  it('laisse tout lire à l’exploitation', async () => {
    const { acces } = creer();

    await expect(
      acces.peutLire(`cv/${AUTRE}_cv.pdf`, { id: MOI, role: Role.SUPER_ADMIN }),
    ).resolves.toBe(true);
  });

  it('refuse une clé mal formée', async () => {
    const { acces } = creer();

    await expect(acces.peutLire('avatars/../cv/x.pdf', etudiant)).resolves.toBe(
      false,
    );
  });
});
