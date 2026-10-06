import { BureauService } from '../bureau/bureau.service';
import { User } from '../user/entities/user.entity';
import { AlerteTresorerieService } from './alerte-tresorerie.service';
import { TypeNotification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

/**
 * La trésorerie doit apprendre ce qui entre — et ce qui attend sa décision —
 * sans ouvrir le tableau de bord. Et une alerte qui échoue ne doit jamais
 * faire échouer le paiement qui l'a déclenchée.
 */
describe('AlerteTresorerieService', () => {
  let service: AlerteTresorerieService;
  let destinatairesTresorerie: jest.Mock;
  let notifierPlusieurs: jest.Mock;

  const compte = (id: string): User => ({ id, firstName: id }) as User;
  const awa = { id: 'awa', firstName: 'Awa', lastName: 'Ndiaye' };

  beforeEach(() => {
    destinatairesTresorerie = jest
      .fn()
      .mockResolvedValue([compte('tresoriere'), compte('exploitant')]);
    notifierPlusieurs = jest.fn().mockResolvedValue(2);

    service = new AlerteTresorerieService(
      { destinatairesTresorerie } as unknown as BureauService,
      { notifierPlusieurs } as unknown as NotificationService,
    );
  });

  describe('encaissement', () => {
    it('annonce qui a payé quoi, et mène à la trésorerie', async () => {
      await service.encaissement({
        origine: 'billetterie',
        payeur: awa,
        objet: 'le billet « Gala »',
        montant: 10_417,
      });

      expect(notifierPlusieurs).toHaveBeenCalledWith(
        [compte('tresoriere'), compte('exploitant')],
        expect.objectContaining({
          type: TypeNotification.PAIEMENT,
          titre: 'Nouvel encaissement — billetterie',
          lien: '/admin/finances',
          libelleLien: 'Ouvrir la trésorerie',
        }),
      );
      const { message } = (
        notifierPlusieurs.mock.calls as [unknown, { message: string }][]
      )[0][1];
      expect(message).toContain('Awa Ndiaye');
      expect(message).toContain('le billet « Gala »');
      expect(message).toContain('10');
    });

    it('dit ce qui arrive réellement en caisse quand le prestataire retient des frais', async () => {
      await service.encaissement({
        origine: 'boutique',
        payeur: awa,
        objet: 'la commande n° 1234abcd',
        montant: 10_417,
        fraisPrestataire: 313,
      });

      const { message } = (
        notifierPlusieurs.mock.calls as [unknown, { message: string }][]
      )[0][1];
      // 10 417 débités, 313 retenus : 10 104 en caisse.
      expect(message).toMatch(/frais du prestataire/);
      expect(message).toContain('10 104');
    });

    it('ne parle pas de frais quand il n’y en a pas', async () => {
      await service.encaissement({
        origine: 'cotisation',
        payeur: awa,
        objet: 'une cotisation',
        montant: 5_000,
        fraisPrestataire: 0,
      });

      const { message } = (
        notifierPlusieurs.mock.calls as [unknown, { message: string }][]
      )[0][1];
      expect(message).not.toMatch(/frais/);
    });

    it('n’annonce pas son paiement à celui qui vient de le faire', async () => {
      // Un trésorier qui règle sa propre cotisation n'a rien à apprendre.
      await service.encaissement({
        origine: 'cotisation',
        payeur: { id: 'tresoriere', firstName: 'Fanta', lastName: 'Sow' },
        objet: 'une cotisation',
        montant: 5_000,
      });

      expect(notifierPlusieurs).toHaveBeenCalledWith(
        [compte('exploitant')],
        expect.anything(),
      );
    });

    it('ne notifie personne quand il n’y a personne à prévenir', async () => {
      destinatairesTresorerie.mockResolvedValue([]);

      await service.encaissement({
        origine: 'boutique',
        payeur: awa,
        objet: 'une commande',
        montant: 1_000,
      });

      expect(notifierPlusieurs).not.toHaveBeenCalled();
    });

    it('ne lève jamais : un paiement reconnu ne doit pas échouer sur une alerte', async () => {
      destinatairesTresorerie.mockRejectedValue(new Error('base injoignable'));

      await expect(
        service.encaissement({
          origine: 'boutique',
          payeur: awa,
          objet: 'une commande',
          montant: 1_000,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('preuve à décider', () => {
    it('dit ce qui attend la décision de la trésorerie', async () => {
      await service.preuveADecider(awa, 'une cotisation — Tranche 1', 5_000);

      expect(notifierPlusieurs).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          titre: 'Preuve de paiement à valider',
          libelleLien: 'Examiner la preuve',
          lien: '/admin/finances',
        }),
      );
      const { message } = (
        notifierPlusieurs.mock.calls as [unknown, { message: string }][]
      )[0][1];
      expect(message).toContain('Awa Ndiaye');
      expect(message).toContain('attend votre décision');
    });
  });
});
