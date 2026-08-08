import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import { DemandePaiement } from '../ports/passerelle-paiement';
import { PasserellePaiementFactice } from './passerelle-paiement-factice';

describe('PasserellePaiementFactice', () => {
  let passerelle: PasserellePaiementFactice;

  const SECRET = 'secret-de-developpement';

  const config = {
    get: (_cle: string, defaut: string) => defaut,
  } as unknown as ConfigService;

  /** En-têtes tels que Fapshi les envoie : un secret, pas une signature. */
  const entetes = (secret = SECRET) => ({ 'x-wh-secret': secret });

  const demande = (
    surcharge: Partial<DemandePaiement> = {},
  ): DemandePaiement => ({
    reference: 'COCFET-0001',
    montant: 5000,
    methode: MethodePaiement.MTN_MOMO,
    telephone: '+237670000000',
    description: 'Billet gala',
    ...surcharge,
  });

  beforeEach(() => {
    passerelle = new PasserellePaiementFactice(config);
  });

  it('accepte un paiement et renvoie une référence externe', async () => {
    const resultat = await passerelle.initier(demande());

    expect(resultat.statut).toBe(StatutPaiement.COMPLETE);
    expect(resultat.referenceExterne).toMatch(/^factice_/);
  });

  it.each([
    // Numéros du bac à sable Fapshi : le même numéro donne la même issue en
    // local et contre le prestataire.
    ['670000001', StatutPaiement.ECHOUE],
    ['+237690000001', StatutPaiement.ECHOUE],
    ['690000002', StatutPaiement.COMPLETE],
    ['677123456', StatutPaiement.EN_ATTENTE],
  ])('rend %s reproductible', async (telephone, attendu) => {
    const resultat = await passerelle.initier(demande({ telephone }));

    expect(resultat.statut).toBe(attendu);
  });

  it('refuse un montant décimal', async () => {
    // Le FCFA n'a pas de subdivision : accepter 1500,5 produirait un écart
    // silencieux avec le relevé du prestataire.
    await expect(
      passerelle.initier(demande({ montant: 1500.5 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('ne crée pas de second débit pour une même référence', async () => {
    const premier = await passerelle.initier(demande());
    const second = await passerelle.initier(demande({ montant: 99999 }));

    expect(second).toEqual(premier);
  });

  it('rejette une notification sans secret', async () => {
    const corps = Buffer.from(JSON.stringify({ reference: 'COCFET-0001' }));

    await expect(passerelle.interpreterWebhook(corps, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejette une notification au mauvais secret', async () => {
    // Le scénario réel : quelqu'un poste un « paiement réussi » sans
    // connaître le secret posé sur le tableau de bord.
    const corps = Buffer.from(
      JSON.stringify({ reference: 'A', statut: StatutPaiement.COMPLETE }),
    );

    await expect(
      passerelle.interpreterWebhook(corps, entetes('mauvais-secret')),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepte une notification authentifiée et met l’intention à jour', async () => {
    await passerelle.initier(demande({ telephone: '677123456' }));

    const corps = Buffer.from(
      JSON.stringify({
        reference: 'COCFET-0001',
        referenceExterne: 'factice_x',
        statut: StatutPaiement.COMPLETE,
      }),
    );
    const evenement = await passerelle.interpreterWebhook(corps, entetes());

    expect(evenement.statut).toBe(StatutPaiement.COMPLETE);
    await expect(passerelle.verifier('COCFET-0001')).resolves.toMatchObject({
      statut: StatutPaiement.COMPLETE,
    });
  });

  it('signale une référence inconnue plutôt que de renvoyer un état vide', async () => {
    await expect(passerelle.verifier('inexistante')).rejects.toThrow(
      BadRequestException,
    );
  });
});
