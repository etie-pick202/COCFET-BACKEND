import {
  StatutMouvementFonds,
  TypeMouvementFonds,
} from './entities/mouvement-fonds.entity';
import { PocheMembre } from './dto/fonds.dto';

/** Un mouvement, réduit à ce que le calcul des poches en lit. */
export interface MouvementPourPoche {
  type: TypeMouvementFonds;
  statut: StatutMouvementFonds;
  montant: number;
  membreId: string;
  contrepartieId: string | null;
}

/** Une somme reçue par un membre, hors registre : preuves validées, retraits. */
export interface SommeParMembre {
  membreId: string;
  montant: number;
}

export interface EntreesPoches {
  mouvements: MouvementPourPoche[];
  /** Preuves de paiement validées, par membre qui a reçu l'argent. */
  preuves: SommeParMembre[];
  /** Retraits Fapshi aboutis, par membre à qui ils sont attribués. */
  retraits: SommeParMembre[];
  /** Noms, par identifiant : de quoi dire « Awa Ngassa » plutôt qu'un uuid. */
  noms: Map<string, string>;
}

type Brouillon = Omit<PocheMembre, 'membre' | 'detient'>;

/**
 * Ce que chaque membre détient, calculé depuis les écritures.
 *
 * **Une poche n'est jamais stockée** : elle se recalcule, comme un solde se
 * déduit d'un relevé. Aucun compteur ne peut donc dériver de ce qu'il résume.
 *
 * - reçu : preuves validées dont il a reçu l'argent + réceptions déclarées ;
 * - retiré : retraits Fapshi qui lui sont attribués ;
 * - sorti : transferts émis, dépôts sur la plateforme, remboursements,
 *   dépenses ;
 * - en route : dépôts lancés mais pas confirmés — ils ne sont pas retirés de la
 *   poche tant que Fapshi n'a pas confirmé, mais ils sont **réservés** : on ne
 *   peut pas les dépenser une seconde fois.
 *
 * Les mouvements échoués ne comptent nulle part.
 */
export function calculerPoches(entrees: EntreesPoches): PocheMembre[] {
  const brouillons = new Map<string, Brouillon>();
  const ligne = (id: string): Brouillon => {
    let b = brouillons.get(id);
    if (!b) {
      b = { recu: 0, retire: 0, transfertsRecus: 0, sorti: 0, enRoute: 0 };
      brouillons.set(id, b);
    }
    return b;
  };

  for (const p of entrees.preuves) ligne(p.membreId).recu += p.montant;
  for (const r of entrees.retraits) ligne(r.membreId).retire += r.montant;

  for (const m of entrees.mouvements) {
    if (m.statut === StatutMouvementFonds.ECHOUE) continue;

    if (m.statut === StatutMouvementFonds.EN_ATTENTE) {
      ligne(m.membreId).enRoute += m.montant;
      continue;
    }

    if (m.type === TypeMouvementFonds.RECEPTION) {
      ligne(m.membreId).recu += m.montant;
      continue;
    }

    ligne(m.membreId).sorti += m.montant;
    if (m.type === TypeMouvementFonds.TRANSFERT && m.contrepartieId) {
      ligne(m.contrepartieId).transfertsRecus += m.montant;
    }
  }

  return [...brouillons.entries()]
    .map(([id, b]) => ({
      membre: { id, nom: entrees.noms.get(id) ?? 'Membre inconnu' },
      ...b,
      detient: b.recu + b.retire + b.transfertsRecus - b.sorti,
    }))
    .sort((a, b) => b.detient - a.detient);
}

/** Ce qu'un membre peut encore sortir : sa poche, moins ce qui est en route. */
export function disponible(poche: PocheMembre | undefined): number {
  return poche ? poche.detient - poche.enRoute : 0;
}
