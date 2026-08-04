import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import { DemandePaiement } from '../ports/passerelle-paiement';
import { PasserellePaiementFactice } from './passerelle-paiement-factice';

describe('PasserellePaiementFactice', () => {
  let passerelle: PasserellePaiementFactice;

  const config = {
    get: (_cle: string, defaut: string) => defaut,
  } as unknown as ConfigService;

  const demande = (
    surcharge: Partial<DemandePaiement> = {},
  ): DemandePaiement => ({
    reference: 'COCFET-0001',
    montant: 5000,
    methode: MethodePaiement.MTN_MOMO,
    telephone: '+237699000002',
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
    ['+237699000000', StatutPaiement.ECHOUE],
    ['+237699000001', StatutPaiement.EN_ATTENTE],
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

  it('rejette un webhook non signé', () => {
    const corps = Buffer.from(JSON.stringify({ reference: 'COCFET-0001' }));

    expect(() => passerelle.interpreterWebhook(corps)).toThrow(
      BadRequestException,
    );
  });

  it('rejette un webhook dont le corps a été modifié après signature', () => {
    // Le scénario réel : un attaquant rejoue une notification légitime en
    // remplaçant le statut par COMPLETE.
    const legitime = Buffer.from(
      JSON.stringify({ reference: 'A', statut: StatutPaiement.ECHOUE }),
    );
    const signature = passerelle.signer(legitime);
    const falsifie = Buffer.from(
      JSON.stringify({ reference: 'A', statut: StatutPaiement.COMPLETE }),
    );

    expect(() => passerelle.interpreterWebhook(falsifie, signature)).toThrow(
      BadRequestException,
    );
  });

  it('accepte un webhook correctement signé et met l’intention à jour', async () => {
    await passerelle.initier(demande({ telephone: '+237699000001' }));

    const corps = Buffer.from(
      JSON.stringify({
        reference: 'COCFET-0001',
        referenceExterne: 'factice_x',
        statut: StatutPaiement.COMPLETE,
      }),
    );
    const evenement = passerelle.interpreterWebhook(
      corps,
      passerelle.signer(corps),
    );

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
