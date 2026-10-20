import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Options à choisir à l'inscription à un événement.
 *
 * Un événement peut demander, avant le paiement, un choix à chaque inscrit :
 * la taille du T-shirt compris dans le tarif, un menu, une pointure. Chaque
 * option est une liste de valeurs, dont chacune peut avoir un **stock** — on
 * ne commande pas plus de T-shirts XL qu'on n'en a prévu.
 *
 * Rien ici ne dépend de la taille de T-shirt : c'est un mécanisme général, que
 * les événements sans option n'ont jamais à connaître.
 */

export interface ChoixOption {
  valeur: string;
  /** Nombre maximal d'inscrits à choisir cette valeur. `null` : illimité. */
  stock: number | null;
}

export interface OptionEvenement {
  /** Identifiant stable, tiré du libellé : c'est la clé des réponses. */
  cle: string;
  libelle: string;
  obligatoire: boolean;
  choix: ChoixOption[];
}

/** Les réponses d'un inscrit : clé d'option → valeur choisie. */
export type Reponses = Record<string, string>;

/** Ce que le bureau saisit, avant normalisation. */
export interface OptionSaisie {
  cle?: string;
  libelle: string;
  obligatoire?: boolean;
  choix: { valeur: string; stock?: number | null }[];
}

/** Combien d'inscrits ont choisi une valeur, par état du paiement. */
export interface Utilisation {
  cle: string;
  valeur: string;
  confirmees: number;
  enAttente: number;
}

export const OPTIONS_MAX = 5;
export const CHOIX_MAX = 20;
/** Par défaut, les choix se figent trois jours avant l'événement. */
export const JOURS_FIGEAGE_PAR_DEFAUT = 3;

/** Retire les tirets du début et de la fin, sans expression régulière. */
function rognerTirets(texte: string): string {
  let debut = 0;
  let fin = texte.length;
  while (debut < fin && texte[debut] === '-') {
    debut += 1;
  }
  while (fin > debut && texte[fin - 1] === '-') {
    fin -= 1;
  }
  return texte.slice(debut, fin);
}

/** « Taille de T-shirt » → « taille-de-t-shirt » : sans accents, sans casse. */
export function cleDepuisLibelle(libelle: string): string {
  const cle = rognerTirets(
    libelle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  );

  // Rogné deux fois : couper à 30 caractères peut laisser un tiret à la fin.
  return rognerTirets(cle.slice(0, 30)) || 'option';
}

/**
 * Met au propre les options saisies par le bureau.
 *
 * Libellés et valeurs nettoyés, valeurs en double écartées (sans égard à la
 * casse), clés uniques, une option sans aucun choix refusée : elle ne
 * permettrait de répondre à rien.
 */
export function normaliserOptions(saisies: OptionSaisie[]): OptionEvenement[] {
  if (saisies.length > OPTIONS_MAX) {
    throw new BadRequestException(
      `Un événement ne peut pas avoir plus de ${OPTIONS_MAX} options.`,
    );
  }

  const clesPrises = new Set<string>();

  return saisies.map((saisie) => {
    const libelle = saisie.libelle.replace(/\s+/g, ' ').trim();
    if (!libelle) {
      throw new BadRequestException('Chaque option doit avoir un intitulé.');
    }

    const vues = new Set<string>();
    const choix: ChoixOption[] = [];
    for (const brut of saisie.choix) {
      const valeur = brut.valeur.replace(/\s+/g, ' ').trim();
      const identite = valeur.toLowerCase();
      if (!valeur || vues.has(identite)) {
        continue;
      }
      vues.add(identite);
      choix.push({ valeur, stock: brut.stock ?? null });
    }

    if (choix.length === 0) {
      throw new BadRequestException(
        `L'option « ${libelle} » doit proposer au moins un choix.`,
      );
    }
    if (choix.length > CHOIX_MAX) {
      throw new BadRequestException(
        `L'option « ${libelle} » ne peut pas proposer plus de ${CHOIX_MAX} choix.`,
      );
    }

    const base = saisie.cle?.trim() || cleDepuisLibelle(libelle);
    let cle = base;
    let rang = 2;
    while (clesPrises.has(cle)) {
      cle = `${base}-${rang}`;
      rang += 1;
    }
    clesPrises.add(cle);

    return { cle, libelle, obligatoire: saisie.obligatoire ?? false, choix };
  });
}

/** Refuse un corps de requête qui n'est pas un objet de réponses. */
function lireReponsesBrutes(brutes: unknown): Record<string, unknown> {
  if (brutes === undefined || brutes === null) {
    return {};
  }
  if (typeof brutes !== 'object' || Array.isArray(brutes)) {
    throw new BadRequestException('Les réponses doivent être un objet.');
  }
  return brutes as Record<string, unknown>;
}

/** Vérifie qu'une valeur reçue figure parmi les choix de l'option. */
function verifierValeur(option: OptionEvenement, valeur: unknown): string {
  if (
    typeof valeur !== 'string' ||
    !option.choix.some((c) => c.valeur === valeur)
  ) {
    throw new BadRequestException(
      `« ${String(valeur)} » n'est pas un choix proposé pour « ${option.libelle} ».`,
    );
  }
  return valeur;
}

/**
 * Contrôle les réponses d'un inscrit contre les options de l'événement.
 *
 * Une clé inconnue ou une valeur hors liste est refusée : accepter du texte
 * libre ferait de la taille « grand » ou « XL, ou L si pas dispo », impossible
 * à compter pour une commande. Avec `exigerObligatoires`, toute option
 * obligatoire doit avoir sa réponse.
 *
 * Les clés écrites dans le résultat sont celles des **options**, jamais celles
 * du client : une clé reçue ne sert qu'à vérifier qu'elle existe.
 */
export function validerReponses(
  options: OptionEvenement[],
  brutes: unknown,
  exigerObligatoires: boolean,
): Reponses {
  const recues = lireReponsesBrutes(brutes);

  const connues = new Set(options.map((o) => o.cle));
  const inconnue = Object.keys(recues).find((cle) => !connues.has(cle));
  if (inconnue !== undefined) {
    throw new BadRequestException(`Option inconnue : « ${inconnue} ».`);
  }

  const reponses: Reponses = {};
  for (const option of options) {
    if (Object.hasOwn(recues, option.cle)) {
      reponses[option.cle] = verifierValeur(option, recues[option.cle]);
    } else if (exigerObligatoires && option.obligatoire) {
      throw new BadRequestException(`Choisissez : ${option.libelle}.`);
    }
  }

  return reponses;
}

/** Vrai quand toutes les options obligatoires ont une réponse. */
export function reponsesCompletes(
  options: OptionEvenement[],
  reponses: Reponses | null | undefined,
): boolean {
  return options.every(
    (option) => !option.obligatoire || reponses?.[option.cle] !== undefined,
  );
}

/** Instant où les choix se figent : `jours` avant le début de l'événement. */
export function dateFigeage(dateDebut: Date, jours: number): Date {
  return new Date(dateDebut.getTime() - jours * 24 * 60 * 60 * 1000);
}

/**
 * Ce qui, dans de nouvelles options, contredit des choix déjà faits.
 *
 * Retirer une valeur déjà choisie, ou baisser un stock sous ce qui est pris,
 * laisserait des inscrits avec une réponse qui n'existe plus. Le bureau doit
 * alors d'abord agir sur ces inscriptions — la liste dit lesquelles.
 */
export function conflitsAvecLesChoix(
  options: OptionEvenement[],
  utilisations: Utilisation[],
): string[] {
  const conflits: string[] = [];

  for (const u of utilisations) {
    const option = options.find((o) => o.cle === u.cle);
    const choix = option?.choix.find((c) => c.valeur === u.valeur);
    const pris = u.confirmees + u.enAttente;

    if (!option || !choix) {
      conflits.push(
        `« ${u.valeur} » (${u.cle}) est déjà choisi par ${pris} inscrit(s).`,
      );
    } else if (choix.stock !== null && choix.stock < pris) {
      conflits.push(
        `« ${u.valeur} » (${option.libelle}) est déjà choisi par ${pris} inscrit(s) : le stock ne peut pas descendre à ${choix.stock}.`,
      );
    }
  }

  return conflits;
}

/**
 * Combien d'inscrits ont choisi chaque valeur.
 *
 * Les inscriptions annulées ne comptent pas : annuler rend la taille. Une
 * inscription **en attente** compte aussi — elle tient sa place et sa taille
 * tant qu'elle n'est pas annulée, comme elle tient son siège.
 */
export async function lireUtilisations(
  gestionnaire: EntityManager,
  evenementId: string,
  exclureInscription: string | null = null,
): Promise<Utilisation[]> {
  const lignes = await gestionnaire.query<
    { cle: string; valeur: string; confirmees: string; en_attente: string }[]
  >(
    `SELECT j.key AS cle, j.value AS valeur,
            COUNT(*) FILTER (WHERE i.statut IN ('CONFIRMEE', 'UTILISEE')) AS confirmees,
            COUNT(*) FILTER (WHERE i.statut = 'EN_ATTENTE') AS en_attente
       FROM inscriptions i, jsonb_each_text(i.reponses) AS j
      WHERE i.evenement_id = $1
        AND i.statut <> 'ANNULEE'
        AND ($2::uuid IS NULL OR i.id <> $2::uuid)
      GROUP BY j.key, j.value`,
    [evenementId, exclureInscription],
  );

  return lignes.map((l) => ({
    cle: l.cle,
    valeur: l.valeur,
    confirmees: Number(l.confirmees),
    enAttente: Number(l.en_attente),
  }));
}
