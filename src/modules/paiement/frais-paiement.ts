import { ConfigService } from '@nestjs/config';
import { MethodePaiement } from './enums/paiement.enum';

/**
 * Taux appliqués pour calculer les frais répercutés sur l'acheteur.
 *
 * Trois frais réels entourent un encaissement Mobile Money, mais un seul est
 * proportionnel à *cette* vente :
 *
 * - **Fapshi (3 %)** est prélevé sur le montant encaissé, confirmé et
 *   identique pour MTN et Orange (fapshi.com/en/pricing). Fapshi affiche en
 *   revanche **0 % sur les décaissements** — verser le solde Fapshi vers un
 *   compte MTN MoMo ou Orange Money ne coûte rien, quoi qu'on ait pu croire.
 * - **Le retrait Mobile Money** (sortir l'argent du compte MTN/Orange en
 *   liquide) coûte, lui, un pourcentage par palier — et les paliers diffèrent
 *   d'un opérateur à l'autre. Une vente précise ne finance pas un retrait
 *   précis : l'argent d'un billet se mélange à celui des autres avant d'être
 *   retiré en une fois. Le taux ci-dessous n'est donc qu'une approximation,
 *   calée sur le palier qui couvre la plupart des prix de billets — à
 *   ajuster si la trésorerie retire des sommes qui tombent dans un autre
 *   palier.
 *
 * Toutes les valeurs sont surchargeables par variable d'environnement, sans
 * quoi elles retombent sur les grilles publiées à la création de cette
 * fonctionnalité (2026) : Fapshi 3 % ; MTN MoMo 1,5 % + 4 F (palier
 * 3 334–266 666 F) ; Orange Money 1 % + 4 F (palier 5 000–399 999 F). Ces
 * grilles évoluent : les revérifier avant d'ajuster une valeur ici.
 */
export interface TauxFrais {
  fapshi: number;
  retraitTaux: Record<MethodePaiement, number>;
  retraitFixe: Record<MethodePaiement, number>;
}

export const TAUX_FRAIS_PAR_DEFAUT: TauxFrais = {
  fapshi: 0.03,
  retraitTaux: {
    [MethodePaiement.MTN_MOMO]: 0.015,
    [MethodePaiement.ORANGE_MONEY]: 0.01,
  },
  retraitFixe: {
    [MethodePaiement.MTN_MOMO]: 4,
    [MethodePaiement.ORANGE_MONEY]: 4,
  },
};

export interface DetailFrais {
  /** Prix de base, celui que l'acheteur voit sur l'événement ou le produit. */
  prixBase: number;
  /** Part de Fapshi sur l'encaissement. */
  fraisFapshi: number;
  /** Provision pour le futur retrait Mobile Money du solde encaissé. */
  fraisRetrait: number;
  /** Ce qui est réellement envoyé à Fapshi — prixBase + les deux frais. */
  montantTtc: number;
}

/**
 * Calcule le montant à encaisser pour qu'après les deux frais, la somme qui
 * reste — au moment du retrait — vaille `prixBase`.
 *
 * **L'ordre du calcul compte.** Le retrait porte sur ce qui atterrit dans le
 * portefeuille Mobile Money, donc sur `prixBase` seul — Fapshi ne prélève
 * rien au décaissement. Fapshi, lui, prélève sur la totalité effectivement
 * encaissée, retrait compris : le majorer seulement sur `prixBase` laisserait
 * Fapshi grignoter la provision de retrait, et elle ne suffirait plus le jour
 * venu. Le frais Fapshi est donc calculé en dernier, sur `prixBase +
 * fraisRetrait`.
 *
 * `Math.ceil` aux deux étapes : arrondir en dessous laisserait Fapshi
 * prélever plus que la marge calculée, et l'organisation recevrait un peu
 * moins que `prixBase`.
 */
export function calculerFrais(
  prixBase: number,
  methode: MethodePaiement,
  taux: TauxFrais = TAUX_FRAIS_PAR_DEFAUT,
): DetailFrais {
  const fraisRetrait = Math.ceil(
    prixBase * taux.retraitTaux[methode] + taux.retraitFixe[methode],
  );

  const sousTotal = prixBase + fraisRetrait;
  const montantTtc = Math.ceil(sousTotal / (1 - taux.fapshi));
  const fraisFapshi = montantTtc - sousTotal;

  return { prixBase, fraisFapshi, fraisRetrait, montantTtc };
}

/** Lit les taux depuis la configuration, avec repli sur les valeurs connues. */
export function tauxFraisDepuisConfig(config: ConfigService): TauxFrais {
  const nombre = (cle: string, defaut: number): number => {
    const valeur = config.get<string>(cle);
    return valeur !== undefined && valeur !== '' ? Number(valeur) : defaut;
  };

  return {
    fapshi: nombre('FAPSHI_TAUX_FRAIS', TAUX_FRAIS_PAR_DEFAUT.fapshi),
    retraitTaux: {
      [MethodePaiement.MTN_MOMO]: nombre(
        'RETRAIT_MOMO_TAUX',
        TAUX_FRAIS_PAR_DEFAUT.retraitTaux[MethodePaiement.MTN_MOMO],
      ),
      [MethodePaiement.ORANGE_MONEY]: nombre(
        'RETRAIT_OM_TAUX',
        TAUX_FRAIS_PAR_DEFAUT.retraitTaux[MethodePaiement.ORANGE_MONEY],
      ),
    },
    retraitFixe: {
      [MethodePaiement.MTN_MOMO]: nombre(
        'RETRAIT_MOMO_FIXE',
        TAUX_FRAIS_PAR_DEFAUT.retraitFixe[MethodePaiement.MTN_MOMO],
      ),
      [MethodePaiement.ORANGE_MONEY]: nombre(
        'RETRAIT_OM_FIXE',
        TAUX_FRAIS_PAR_DEFAUT.retraitFixe[MethodePaiement.ORANGE_MONEY],
      ),
    },
  };
}
