import { ConfigService } from '@nestjs/config';
import { MethodePaiement } from './enums/paiement.enum';
import {
  calculerFrais,
  TAUX_FRAIS_PAR_DEFAUT,
  tauxFraisDepuisConfig,
} from './frais-paiement';

/**
 * Calcul des frais répercutés sur l'acheteur.
 *
 * Le point qui compte : après les deux prélèvements — Fapshi à l'encaissement,
 * Mobile Money au retrait — il doit rester exactement `prixBase`, pas moins.
 * Sans quoi chaque vente coûterait un peu d'argent à l'organisation au lieu
 * de lui en rapporter.
 */
describe('calculerFrais', () => {
  it('laisse exactement prixBase après les deux frais', () => {
    const detail = calculerFrais(5000, MethodePaiement.ORANGE_MONEY);

    // Ce que Fapshi prélève sur le montant réellement encaissé.
    const preleveFapshi = Math.round(
      detail.montantTtc * TAUX_FRAIS_PAR_DEFAUT.fapshi,
    );
    const netApresFapshi = detail.montantTtc - preleveFapshi;
    // Ce qu'un retrait de ce montant coûterait ensuite.
    const preleveRetrait = detail.fraisRetrait;
    const netFinal = netApresFapshi - preleveRetrait;

    // À l'arrondi près : les deux calculs arrondissent indépendamment.
    expect(Math.abs(netFinal - 5000)).toBeLessThanOrEqual(2);
  });

  it('calcule le frais Fapshi sur le retrait aussi, pas seulement sur le prix', () => {
    // Sans cela, Fapshi grignoterait la provision de retrait, et elle ne
    // suffirait plus au moment venu.
    const detail = calculerFrais(5000, MethodePaiement.ORANGE_MONEY);
    const sousTotal = detail.prixBase + detail.fraisRetrait;

    expect(detail.montantTtc).toBeGreaterThan(sousTotal);
    expect(detail.fraisFapshi).toBe(detail.montantTtc - sousTotal);
  });

  it('distingue le taux de retrait par opérateur', () => {
    const orange = calculerFrais(50_000, MethodePaiement.ORANGE_MONEY);
    const momo = calculerFrais(50_000, MethodePaiement.MTN_MOMO);

    // MTN (1,5 %) coûte plus cher au retrait qu'Orange (1 %) sur ce palier.
    expect(momo.fraisRetrait).toBeGreaterThan(orange.fraisRetrait);
  });

  it('rend prixBase inchangé dans le détail rendu', () => {
    const detail = calculerFrais(12_000, MethodePaiement.MTN_MOMO);

    expect(detail.prixBase).toBe(12_000);
  });

  it('ne produit jamais un montant total inférieur au prix affiché', () => {
    for (const prix of [100, 999, 5000, 123_456]) {
      const detail = calculerFrais(prix, MethodePaiement.ORANGE_MONEY);
      expect(detail.montantTtc).toBeGreaterThan(prix);
    }
  });
});

describe('tauxFraisDepuisConfig', () => {
  it('retombe sur les valeurs connues quand rien n’est configuré', () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    const taux = tauxFraisDepuisConfig(config);

    expect(taux).toEqual(TAUX_FRAIS_PAR_DEFAUT);
  });

  it('lit les taux surchargés depuis la configuration', () => {
    const valeurs: Record<string, string> = {
      FAPSHI_TAUX_FRAIS: '0.05',
      RETRAIT_MOMO_TAUX: '0.02',
      RETRAIT_MOMO_FIXE: '10',
      RETRAIT_OM_TAUX: '0.015',
      RETRAIT_OM_FIXE: '5',
    };
    const config = {
      get: jest.fn((cle: string) => valeurs[cle]),
    } as unknown as ConfigService;

    const taux = tauxFraisDepuisConfig(config);

    expect(taux.fapshi).toBeCloseTo(0.05);
    expect(taux.retraitTaux[MethodePaiement.MTN_MOMO]).toBeCloseTo(0.02);
    expect(taux.retraitFixe[MethodePaiement.MTN_MOMO]).toBe(10);
    expect(taux.retraitTaux[MethodePaiement.ORANGE_MONEY]).toBeCloseTo(0.015);
    expect(taux.retraitFixe[MethodePaiement.ORANGE_MONEY]).toBe(5);
  });

  it('ignore une variable posée mais vide', () => {
    // Une chaîne vide n'est pas un taux de zéro voulu : elle doit retomber
    // sur la valeur connue, comme si la variable n'existait pas.
    const config = { get: jest.fn(() => '') } as unknown as ConfigService;

    const taux = tauxFraisDepuisConfig(config);

    expect(taux).toEqual(TAUX_FRAIS_PAR_DEFAUT);
  });
});
