/**
 * Reconnaissance des adresses de l'UCAC-ICAM.
 *
 * Deux formats existent, un par campus :
 *   prenom.nom@2027.ucac-icam.com   (Cameroun)
 *   prenom.nom@2026.icam.fr         (France)
 *
 * Le sous-domaine numérique porte l'année de sortie, donc la promotion.
 * Une adresse du même domaine **sans** sous-domaine numérique désigne le
 * personnel : elle est reconnue comme institutionnelle mais n'ouvre droit à
 * aucune promotion ni tarif campus.
 *
 * Ce module ne fait que **lire** une adresse. Il n'accorde aucun droit : c'est
 * la vérification de l'email qui prouve la possession de la boîte, et elle
 * seule. Sans cela, n'importe qui inventerait une adresse au bon format pour
 * obtenir le tarif campus.
 */

export const DOMAINES_INSTITUTIONNELS = ['ucac-icam.com', 'icam.fr'] as const;

export type DomaineInstitutionnel = (typeof DOMAINES_INSTITUTIONNELS)[number];

export enum TypeIdentite {
  /** Adresse institutionnelle portant une promotion. */
  ETUDIANT = 'ETUDIANT',
  /** Adresse institutionnelle sans promotion. */
  PERSONNEL = 'PERSONNEL',
  /** Toute autre adresse. */
  EXTERNE = 'EXTERNE',
}

export interface IdentiteCampus {
  type: TypeIdentite;
  /** Année de sortie, uniquement pour TypeIdentite.ETUDIANT. */
  promotion: number | null;
  domaine: DomaineInstitutionnel | null;
}

/**
 * Fenêtre acceptée autour de la génération active. Une adresse annonçant une
 * promotion hors de ces bornes est traitée comme institutionnelle sans
 * promotion : mieux vaut refuser un avantage à tort que d'accepter
 * « @1899.icam.fr » ou « @2199.icam.fr ».
 */
export const ANNEES_PASSEES_ACCEPTEES = 10;
export const ANNEES_FUTURES_ACCEPTEES = 6;

/**
 * Ramène une adresse à sa forme canonique, utilisée pour le contrôle
 * d'unicité.
 *
 * Le suffixe `+…` est retiré : la plupart des messageries livrent
 * `etienne+1@`, `etienne+2@` dans **la même boîte**. Sans cette normalisation,
 * une seule boîte permettrait de créer autant de comptes que voulu — donc
 * autant de tarifs campus, de votes et de quotas sponsors.
 */
export function normaliserEmail(email: string): string {
  const brut = email.trim().toLowerCase();
  const arobase = brut.lastIndexOf('@');
  if (arobase === -1) {
    return brut;
  }

  const partieLocale = brut.slice(0, arobase);
  const domaine = brut.slice(arobase + 1);
  const plus = partieLocale.indexOf('+');

  return plus === -1
    ? `${partieLocale}@${domaine}`
    : `${partieLocale.slice(0, plus)}@${domaine}`;
}

/**
 * Analyse une adresse et en déduit le type d'identité.
 *
 * @param anneeGenerationActive sert uniquement à borner les promotions
 *   plausibles. Sans elle, aucune borne n'est appliquée.
 */
export function lireIdentiteCampus(
  email: string,
  anneeGenerationActive?: number,
): IdentiteCampus {
  const normalise = normaliserEmail(email);
  const domaineComplet = normalise.slice(normalise.lastIndexOf('@') + 1);

  const domaine = DOMAINES_INSTITUTIONNELS.find(
    (candidat) =>
      domaineComplet === candidat || domaineComplet.endsWith(`.${candidat}`),
  );

  if (!domaine) {
    return { type: TypeIdentite.EXTERNE, promotion: null, domaine: null };
  }

  // Le sous-domaine est ce qui précède le domaine institutionnel.
  const sousDomaine =
    domaineComplet === domaine
      ? ''
      : domaineComplet.slice(0, domaineComplet.length - domaine.length - 1);

  // Seul un sous-domaine strictement numérique de 4 chiffres porte une
  // promotion. « dsi.ucac-icam.com » est du personnel, pas un étudiant.
  if (!/^\d{4}$/.test(sousDomaine)) {
    return { type: TypeIdentite.PERSONNEL, promotion: null, domaine };
  }

  const promotion = Number(sousDomaine);

  if (!promotionPlausible(promotion, anneeGenerationActive)) {
    return { type: TypeIdentite.PERSONNEL, promotion: null, domaine };
  }

  return { type: TypeIdentite.ETUDIANT, promotion, domaine };
}

function promotionPlausible(
  promotion: number,
  anneeGenerationActive?: number,
): boolean {
  if (anneeGenerationActive === undefined) {
    return true;
  }
  return (
    promotion >= anneeGenerationActive - ANNEES_PASSEES_ACCEPTEES &&
    promotion <= anneeGenerationActive + ANNEES_FUTURES_ACCEPTEES
  );
}

/**
 * Détermine si un compte bénéficie du tarif campus.
 *
 * **Le tarif ne découle pas du rôle.** Un ancien diplômé conserve le rôle
 * étudiant et l'accès à la communauté, mais paie le tarif externe : sa
 * promotion est antérieure à celle de la génération en cours, il n'est plus
 * scolarisé. Un étudiant de 2029 est encore scolarisé quand la génération
 * active est 2027, il paie donc le tarif campus.
 *
 * La bascule est automatique : au passage de la génération 2027 à 2028, les
 * promotions 2027 perdent le tarif campus sans aucune intervention.
 */
export function beneficieDuTarifCampus(
  promotion: number | null,
  anneeGenerationActive: number,
): boolean {
  return promotion !== null && promotion >= anneeGenerationActive;
}
