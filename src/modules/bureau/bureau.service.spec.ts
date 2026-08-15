import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Generation } from '../generation/entities/generation.entity';
import { MailService } from '../mail/mail.service';
import { User } from '../user/entities/user.entity';
import { BureauService } from './bureau.service';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';
import { PreferenceEmailService } from '../notification/preference-email.service';

/**
 * Concentré sur la désignation d'un membre : c'est le geste qui déclenche
 * l'accueil par email, et le seul dont l'échec silencieux se remarquerait
 * seulement le jour où quelqu'un demanderait pourquoi il n'a rien reçu.
 */
describe('BureauService — désignation', () => {
  let service: BureauService;
  let envoyerBienvenueAuBureau: jest.Mock;
  let postes: { findOne: jest.Mock };
  let membres: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let generations: { findOne: jest.Mock };
  let users: { findOne: jest.Mock };

  const generation = (surcharge: Partial<Generation> = {}): Generation =>
    ({
      id: 'generation-id',
      nom: 'ATLAS',
      annee: 2027,
      archivedAt: null,
      ...surcharge,
    }) as Generation;

  const poste = (surcharge: Partial<PosteBureau> = {}): PosteBureau =>
    ({
      id: 'poste-id',
      nom: 'Trésorière',
      description: 'Tient les comptes du mandat.',
      accordeAdministration: false,
      ...surcharge,
    }) as PosteBureau;

  const user = (surcharge: Partial<User> = {}): User =>
    ({
      id: 'user-id',
      email: 'awa@2027.ucac-icam.com',
      firstName: 'Awa',
      promotion: 2027,
      emailVerifieLe: new Date(),
      ...surcharge,
    }) as User;

  const affectation = { posteId: 'poste-id', userId: 'user-id' };

  const preferenceEmail = { autorise: jest.fn().mockResolvedValue(true) };

  beforeEach(() => {
    envoyerBienvenueAuBureau = jest.fn(() => Promise.resolve());
    preferenceEmail.autorise.mockResolvedValue(true);

    postes = { findOne: jest.fn(() => Promise.resolve(poste())) };
    generations = { findOne: jest.fn(() => Promise.resolve(generation())) };
    users = { findOne: jest.fn(() => Promise.resolve(user())) };
    membres = {
      // Aucun titulaire en place pour ce poste.
      findOne: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((entite: Partial<MembreBureau>) => entite),
      save: jest.fn((entite: MembreBureau) =>
        Promise.resolve({ ...entite, id: 'membre-id' }),
      ),
    };

    service = new BureauService(
      postes as unknown as Repository<PosteBureau>,
      membres as unknown as Repository<MembreBureau>,
      generations as unknown as Repository<Generation>,
      users as unknown as Repository<User>,
      { envoyerBienvenueAuBureau } as unknown as MailService,
      preferenceEmail as unknown as PreferenceEmailService,
    );
  });

  it('accueille le membre en nommant son poste et son mandat', async () => {
    await service.affecter('generation-id', affectation);

    expect(envoyerBienvenueAuBureau).toHaveBeenCalledWith(
      'awa@2027.ucac-icam.com',
      'Awa',
      expect.objectContaining({
        poste: 'Trésorière',
        mandat: 'ATLAS',
        annee: 2027,
        mission: 'Tient les comptes du mandat.',
      }),
    );
  });

  it('signale les postes qui ouvrent l’administration', async () => {
    // Sans cette mention, la personne se connecte, ne voit rien de nouveau, et
    // conclut à une panne : ses droits n'arrivent qu'à l'activation du mandat.
    postes.findOne.mockResolvedValue(poste({ accordeAdministration: true }));

    await service.affecter('generation-id', affectation);

    expect(envoyerBienvenueAuBureau).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ administration: true }),
    );
  });

  it('n’envoie rien quand la désignation est refusée', async () => {
    // Un compte d'une autre promotion ne siège pas : le message partirait
    // avant que la règle ne s'applique si l'ordre était inversé.
    users.findOne.mockResolvedValue(user({ promotion: 2026 }));

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow(BadRequestException);
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien à un compte dont l’adresse n’est pas confirmée', async () => {
    users.findOne.mockResolvedValue(user({ emailVerifieLe: null }));

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow('n’a pas confirmé son adresse');
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien quand le poste est déjà occupé', async () => {
    membres.findOne.mockResolvedValue({ id: 'deja-la' });

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow(ConflictException);
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('n’envoie rien sur un mandat archivé', async () => {
    generations.findOne.mockResolvedValue(
      generation({ archivedAt: new Date() }),
    );

    await expect(
      service.affecter('generation-id', affectation),
    ).rejects.toThrow('sa composition ne change plus');
    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('respecte le refus des emails de service', async () => {
    // Un message de confort, pas une piece ni une alerte : couper doit
    // reellement couper, sans quoi le choix offert n'en serait pas un.
    preferenceEmail.autorise.mockResolvedValue(false);

    await service.affecter('g1', { posteId: 'p1', userId: 'u1' });

    expect(envoyerBienvenueAuBureau).not.toHaveBeenCalled();
  });

  it('enregistre la désignation avant d’annoncer quoi que ce soit', async () => {
    // L'ordre compte : un accueil parti sur une désignation qui n'a pas été
    // écrite annoncerait un poste que personne n'occupe.
    const ordre: string[] = [];
    membres.save.mockImplementation((entite: MembreBureau) => {
      ordre.push('enregistrement');
      return Promise.resolve({ ...entite, id: 'membre-id' });
    });
    envoyerBienvenueAuBureau.mockImplementation(() => {
      ordre.push('accueil');
      return Promise.resolve();
    });

    await service.affecter('generation-id', affectation);

    expect(ordre).toEqual(['enregistrement', 'accueil']);
  });
});
