import { ConfigService } from '@nestjs/config';
import { BaremeFraisController } from './bareme-frais.controller';
import { MethodePaiement } from './enums/paiement.enum';
import { calculerFrais, TAUX_FRAIS_PAR_DEFAUT } from './frais-paiement';

describe('BaremeFraisController', () => {
  const controleur = (env: Record<string, string> = {}) =>
    new BaremeFraisController({
      get: (cle: string) => env[cle],
    } as unknown as ConfigService);

  it('publie les taux par défaut et l’opérateur retenu par défaut', () => {
    expect(controleur().bareme()).toEqual({
      ...TAUX_FRAIS_PAR_DEFAUT,
      methodeParDefaut: MethodePaiement.MTN_MOMO,
    });
  });

  it('publie les taux de la configuration, pas des constantes', () => {
    expect(
      controleur({ FAPSHI_TAUX_FRAIS: '0.05' }).bareme().fapshi,
    ).toBeCloseTo(0.05, 5);
  });

  it('suffit à refaire le calcul du serveur', () => {
    const { methodeParDefaut, ...taux } = controleur().bareme();

    expect(calculerFrais(10_000, methodeParDefaut, taux).montantTtc).toBe(
      calculerFrais(10_000, null).montantTtc,
    );
  });
});
