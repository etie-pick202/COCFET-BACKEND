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
 * Une échéance que la personne peut régler : une tranche, ou tout le reste.
 *
 * **Une tranche se règle à son rythme.** Le montant est libre, de
 * `montantMin` à `montant` : cinq mille francs six fois de suite valent trente
 * mille d'un coup, et chaque versement est crédité pour ce qu'il vaut — pas
 * pour la tranche entière. « Tout le reste » est, lui, un montant fixe : le
 * reliquat de la cotisation, jamais son montant d'origine.
 */
export class EcheancePayable {
  @ApiProperty({
    nullable: true,
    description: 'Rang de la tranche ; nul pour « tout le reste ».',
  })
  ordreTranche: number | null;

  @ApiProperty({ example: 'Première tranche' })
  libelle: string;

  @ApiProperty({
    description:
      'Plus grand montant réglable maintenant, en FCFA : ce qu’il reste sur ' +
      'l’échéance, hors versements déjà engagés.',
  })
  montant: number;

  @ApiProperty({
    description:
      'Plus petit montant réglable, en FCFA (jamais au-dessus de « montant »).',
  })
  montantMin: number;

  @ApiProperty({
    description:
      'Vrai pour une tranche : le montant se choisit entre « montantMin » et ' +
      '« montant ». Faux pour « tout le reste », montant fixe.',
  })
  libre: boolean;

  @ApiProperty({ description: 'Taille de l’échéance entière, en FCFA.' })
  montantEcheance: number;

  @ApiProperty({ description: 'Part de l’échéance réellement réglée.' })
  regle: number;

  @ApiProperty({
    description: 'Part versée mais pas encore validée par la trésorerie.',
  })
  enAttente: number;

  @ApiProperty({ description: 'Pourcentage réellement réglé de l’échéance.' })
  pourcentage: number;

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

  @ApiProperty({
    type: FraisParMethode,
    description: 'Frais d’un paiement en ligne du montant maximal.',
  })
  frais: FraisParMethode;
}

export const LIBELLE_TOTALITE = 'Tout le reste dû';
export const LIBELLE_VERSEMENT_LIBRE = 'Versement libre';

/**
 * Plus petit règlement accepté, en FCFA.
 *
 * Un plancher existe parce que chaque paiement en ligne coûte une provision
 * fixe de quatre francs et que le prestataire n'encaisse pas de montants
 * dérisoires ; sans lui, une cotisation se découperait en versements de cent
 * francs, chacun passant par la trésorerie. Il ne bloque jamais la fin d'une
 * échéance : dès qu'il reste moins que le plancher, le reliquat se règle tel
 * quel.
 */
export const MONTANT_MINIMAL_REGLEMENT = 500;

export interface ContexteEcheances {
  ouverte: boolean;
  fractionnable: boolean;
  dateCloture: Date | null;
}

/**
 * Dresse les échéances qu'une personne peut régler, dans l'ordre.
 *
 * **Seule la prochaine tranche non couverte est payable**, avec « tout le
 * reste ». Le solde remplit les tranches dans l'ordre (voir avancement.ts) :
 * proposer la troisième avant la première aurait rempli la première à sa
 * place, et la personne aurait vu avancer une échéance qu'elle n'avait pas
 * choisie.
 *
 * **Ce qui attend sa validation est déjà engagé.** Un justificatif en cours
 * d'examen, ou un paiement en ligne que la personne n'a pas encore validé sur
 * son téléphone, réduit d'autant ce qui reste à proposer. On peut donc lancer
 * plusieurs versements à la suite — sans attendre la trésorerie — mais jamais
 * payer deux fois la même part : la somme de ce qui est engagé ne dépasse
 * jamais le reste dû.
 *
 * Une tranche entièrement couverte par des règlements en attente n'est plus
 * proposée : il n'y a plus rien à y verser, seulement à attendre.
 *
 * Fonction pure, comme `calculerAvancement`.
 */
export function echeancesPayables(
  avancement: Avancement,
  contexte: ContexteEcheances,
  taux?: TauxFrais,
): EcheancePayable[] {
  const disponible = Math.max(
    0,
    avancement.montantRestant - avancement.montantEnAttente,
  );
  if (disponible <= 0) {
    return [];
  }

  const blocage = contexte.ouverte
    ? null
    : 'Cette cotisation n’accepte plus de règlement.';

  const echeances: EcheancePayable[] = [];

  if (contexte.fractionnable && avancement.tranches.length > 0) {
    const aRegler = avancement.tranches
      .filter((t) => !t.soldee)
      .map((t) => ({ tranche: t, capacite: t.montant - t.regle - t.enAttente }))
      .filter(({ capacite }) => capacite > 0);

    aRegler.forEach(({ tranche, capacite }, index) => {
      echeances.push(
        echeance({
          ordreTranche: tranche.ordre,
          libelle: tranche.libelle,
          montant: capacite,
          libre: true,
          montantEcheance: tranche.montant,
          regle: tranche.regle,
          enAttente: tranche.enAttente,
          dateLimite: tranche.dateLimite,
          motif:
            blocage ??
            (index === 0 ? null : 'Réglez d’abord l’échéance précédente.'),
          taux,
        }),
      );
    });

    // Une seule tranche reste à régler et elle vaut tout le reste : proposer
    // aussi « tout le reste » afficherait deux fois le même paiement.
    if (aRegler.length > 0 && aRegler[0].capacite >= disponible) {
      return echeances;
    }
  }

  // Sans échéancier mais fractionnable : un versement libre sur le reste.
  // Non fractionnable : le reste d'un seul tenant.
  const libre = contexte.fractionnable && avancement.tranches.length === 0;

  echeances.push(
    echeance({
      ordreTranche: null,
      libelle: libre ? LIBELLE_VERSEMENT_LIBRE : LIBELLE_TOTALITE,
      montant: disponible,
      libre,
      montantEcheance: avancement.montantDu,
      regle: avancement.montantRegle,
      enAttente: avancement.montantEnAttente,
      dateLimite: contexte.dateCloture
        ? contexte.dateCloture.toISOString()
        : null,
      motif: blocage,
      taux,
    }),
  );

  return echeances;
}

/**
 * Montant que la personne est autorisée à régler sur une échéance.
 *
 * Absent, c'est tout ce qui reste sur l'échéance. Sur une tranche, le montant
 * est libre entre le plancher et le reste ; sur « tout le reste », il est
 * fixe. Un refus dit pourquoi, en des termes que la personne peut corriger.
 */
export function montantAutorise(
  echeance: Pick<EcheancePayable, 'montant' | 'montantMin' | 'libre'>,
  demande?: number,
): { montant: number } | { erreur: string } {
  if (demande === undefined) {
    return { montant: echeance.montant };
  }
  if (!Number.isInteger(demande) || demande < 1) {
    return { erreur: 'Le montant doit être un nombre entier de francs.' };
  }
  if (!echeance.libre) {
    return demande === echeance.montant
      ? { montant: demande }
      : {
          erreur:
            `Cette échéance se règle en une fois : ${echeance.montant} FCFA. ` +
            'Pour verser moins, choisissez une tranche.',
        };
  }
  if (demande > echeance.montant) {
    return {
      erreur: `Il ne reste que ${echeance.montant} FCFA à régler sur cette échéance.`,
    };
  }
  if (demande < echeance.montantMin) {
    return {
      erreur: `Le montant minimal d’un règlement est de ${echeance.montantMin} FCFA.`,
    };
  }
  return { montant: demande };
}

/** Ce que coûterait un paiement en ligne de ce montant, par opérateur. */
export function fraisParMethode(
  montant: number,
  taux?: TauxFrais,
): FraisParMethode {
  return {
    ORANGE_MONEY: versFrais(
      calculerFrais(montant, MethodePaiement.ORANGE_MONEY, taux),
    ),
    MTN_MOMO: versFrais(calculerFrais(montant, MethodePaiement.MTN_MOMO, taux)),
  };
}

function echeance(source: {
  ordreTranche: number | null;
  libelle: string;
  montant: number;
  libre: boolean;
  montantEcheance: number;
  regle: number;
  enAttente: number;
  dateLimite: string | null;
  motif: string | null;
  taux?: TauxFrais;
}): EcheancePayable {
  return {
    ordreTranche: source.ordreTranche,
    libelle: source.libelle,
    montant: source.montant,
    // Le plancher ne dépasse jamais le reste : sinon la fin d'une échéance
    // serait impossible à régler.
    montantMin: Math.min(MONTANT_MINIMAL_REGLEMENT, source.montant),
    libre: source.libre,
    montantEcheance: source.montantEcheance,
    regle: source.regle,
    enAttente: source.enAttente,
    pourcentage:
      source.montantEcheance > 0
        ? Math.min(
            100,
            Math.round((source.regle / source.montantEcheance) * 100),
          )
        : 100,
    dateLimite: source.dateLimite,
    payable: source.motif === null,
    motif: source.motif,
    frais: fraisParMethode(source.montant, source.taux),
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
