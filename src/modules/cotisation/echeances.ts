import { ApiProperty } from '@nestjs/swagger';
import { MethodePaiement } from '../paiement/enums/paiement.enum';
import {
  calculerFrais,
  DetailFrais,
  TauxFrais,
} from '../paiement/frais-paiement';
import { Avancement } from './avancement';

/** Détail de ce que coûterait un paiement en ligne, pour un opérateur. */
export class FraisEcheance {
  @ApiProperty({ description: 'Montant crédité, frais exclus.' })
  prixBase: number;

  @ApiProperty()
  fraisFapshi: number;

  @ApiProperty()
  fraisRetrait: number;

  @ApiProperty({ description: 'Ce que le payeur sera débité.' })
  montantTtc: number;
}

export class FraisParMethode {
  @ApiProperty({ type: FraisEcheance })
  ORANGE_MONEY: FraisEcheance;

  @ApiProperty({ type: FraisEcheance })
  MTN_MOMO: FraisEcheance;
}

/**
 * Une échéance que la personne peut régler : une tranche, ou la totalité.
 *
 * La totalité est une échéance comme une autre — sa date limite est la
 * clôture de la cotisation. Quelqu'un qui préfère tout régler d'un coup la
 * choisit ; quelqu'un qui paie au rythme de l'échéancier choisit la tranche.
 */
export class EcheancePayable {
  @ApiProperty({
    nullable: true,
    description: 'Rang de la tranche ; nul pour la totalité du reste dû.',
  })
  ordreTranche: number | null;

  @ApiProperty({ example: 'Première tranche' })
  libelle: string;

  @ApiProperty({ description: 'Reste à verser sur cette échéance, en FCFA.' })
  montant: number;

  @ApiProperty({ nullable: true, format: 'date-time' })
  dateLimite: string | null;

  @ApiProperty({
    description: 'Faux quand un autre règlement doit passer avant.',
  })
  payable: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Pourquoi l’échéance ne peut pas être réglée maintenant.',
  })
  motif: string | null;

  @ApiProperty({ type: FraisParMethode })
  frais: FraisParMethode;
}

export const LIBELLE_TOTALITE = 'Totalité du reste dû';

export interface ContexteEcheances {
  ouverte: boolean;
  fractionnable: boolean;
  dateCloture: Date | null;
  /** Un règlement attend encore son issue : en lancer un autre doublerait. */
  reglementEnAttente: boolean;
}

/**
 * Dresse les échéances qu'une personne peut régler, dans l'ordre.
 *
 * **Seule la prochaine tranche non soldée est payable**, avec la totalité.
 * C'est ce qui rend le paiement d'une échéance exact : le solde remplit les
 * tranches dans l'ordre (voir avancement.ts), donc régler la prochaine la
 * ferme, ni plus ni moins. Proposer la troisième avant la première aurait
 * rempli la première à sa place, et la personne aurait vu se fermer une
 * échéance qu'elle n'avait pas choisie.
 *
 * Une seule demande à la fois : tant qu'un règlement — en ligne ou par
 * justificatif — attend son issue, rien d'autre n'est payable. Sans cela, la
 * même tranche pourrait être réglée deux fois, en ligne pendant que son
 * justificatif attend la trésorerie.
 *
 * Fonction pure, comme `calculerAvancement`.
 */
export function echeancesPayables(
  avancement: Avancement,
  contexte: ContexteEcheances,
  taux?: TauxFrais,
): EcheancePayable[] {
  if (avancement.montantRestant <= 0) {
    return [];
  }

  let blocage: string | null = null;
  if (!contexte.ouverte) {
    blocage = 'Cette cotisation n’accepte plus de règlement.';
  } else if (contexte.reglementEnAttente) {
    blocage =
      'Un règlement attend déjà son issue : terminez-le ou abandonnez-le d’abord.';
  }

  const echeances: EcheancePayable[] = [];

  if (contexte.fractionnable) {
    const restantes = avancement.tranches.filter((t) => !t.soldee);

    restantes.forEach((tranche, index) => {
      echeances.push(
        echeance(
          tranche.ordre,
          tranche.libelle,
          tranche.montant - tranche.regle,
          tranche.dateLimite,
          blocage ??
            (index === 0 ? null : 'Réglez d’abord l’échéance précédente.'),
          taux,
        ),
      );
    });

    // Une seule tranche restante couvre déjà tout le reste dû : proposer
    // aussi « la totalité » afficherait deux fois le même paiement.
    const prochaine = restantes[0];
    if (
      prochaine &&
      prochaine.montant - prochaine.regle >= avancement.montantRestant
    ) {
      return echeances;
    }
  }

  echeances.push(
    echeance(
      null,
      LIBELLE_TOTALITE,
      avancement.montantRestant,
      contexte.dateCloture ? contexte.dateCloture.toISOString() : null,
      blocage,
      taux,
    ),
  );

  return echeances;
}

function echeance(
  ordreTranche: number | null,
  libelle: string,
  montant: number,
  dateLimite: string | null,
  motif: string | null,
  taux?: TauxFrais,
): EcheancePayable {
  return {
    ordreTranche,
    libelle,
    montant,
    dateLimite,
    payable: motif === null,
    motif,
    frais: {
      ORANGE_MONEY: versFrais(
        calculerFrais(montant, MethodePaiement.ORANGE_MONEY, taux),
      ),
      MTN_MOMO: versFrais(
        calculerFrais(montant, MethodePaiement.MTN_MOMO, taux),
      ),
    },
  };
}

function versFrais(detail: DetailFrais): FraisEcheance {
  return {
    prixBase: detail.prixBase,
    fraisFapshi: detail.fraisFapshi,
    fraisRetrait: detail.fraisRetrait,
    montantTtc: detail.montantTtc,
  };
}
