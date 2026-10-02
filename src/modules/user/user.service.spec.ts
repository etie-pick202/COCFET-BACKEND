import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { UserService } from './user.service';

type Depot = {
  findOne: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
  countBy: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function creer(compte: { id: string; role: Role; avatar?: string | null }) {
  const depot: Depot = {
    findOne: jest.fn().mockResolvedValue(compte),
    delete: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    countBy: jest.fn().mockResolvedValue(2),
    // Lecture par `trouverOuEchouer` : toute la chaîne renvoie le compte.
    createQueryBuilder: jest.fn().mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(compte),
    }),
  };
  const nettoyage = { retirer: jest.fn().mockResolvedValue(undefined) };
  const service = new UserService(depot as never, nettoyage as never);
  return { service, depot, nettoyage };
}

describe('UserService', () => {
  describe('supprimer', () => {
    it('supprime un compte ordinaire sans acteur précisé', async () => {
      const { service, depot, nettoyage } = creer({
        id: 'u1',
        role: Role.SPONSOR,
        avatar: 'a/1.png',
      });

      await service.supprimer('u1');

      expect(depot.delete).toHaveBeenCalledWith('u1');
      expect(nettoyage.retirer).toHaveBeenCalledWith('a/1.png');
    });

    it('refuse de supprimer un super administrateur sans acteur', async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await expect(service.supprimer('s1')).rejects.toThrow(ForbiddenException);
      expect(depot.delete).not.toHaveBeenCalled();
    });

    it("refuse qu'un administrateur supprime un super administrateur", async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await expect(service.supprimer('s1', Role.ADMIN)).rejects.toThrow(
        'Seul un super administrateur',
      );
      expect(depot.delete).not.toHaveBeenCalled();
    });

    it('laisse un super administrateur en supprimer un autre', async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await service.supprimer('s1', Role.SUPER_ADMIN);

      expect(depot.delete).toHaveBeenCalledWith('s1');
    });
  });

  describe('administrer', () => {
    it("refuse qu'un administrateur désactive un super administrateur", async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await expect(
        service.administrer('s1', { isActive: false }, 'a1', Role.ADMIN),
      ).rejects.toThrow(ForbiddenException);
      expect(depot.update).not.toHaveBeenCalled();
    });

    it("refuse qu'un administrateur rétrograde un super administrateur", async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await expect(
        service.administrer('s1', { role: Role.STUDENT }, 'a1', Role.ADMIN),
      ).rejects.toThrow(ForbiddenException);
      expect(depot.update).not.toHaveBeenCalled();
    });

    it('laisse un super administrateur modifier un autre super administrateur', async () => {
      const { service, depot } = creer({ id: 's1', role: Role.SUPER_ADMIN });

      await service.administrer(
        's1',
        { isFinissant: true },
        's2',
        Role.SUPER_ADMIN,
      );

      expect(depot.update).toHaveBeenCalledWith('s1', { isFinissant: true });
    });

    it('laisse un administrateur modifier un compte ordinaire', async () => {
      const { service, depot } = creer({ id: 'u1', role: Role.STUDENT });

      await service.administrer('u1', { isFinissant: true }, 'a1', Role.ADMIN);

      expect(depot.update).toHaveBeenCalledWith('u1', { isFinissant: true });
    });
  });
});
