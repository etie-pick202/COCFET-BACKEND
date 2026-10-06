import { ApiProperty } from '@nestjs/swagger';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';

/** Où en est une tranche, une fois le solde réparti dessus. */
export class AvancementTranche {
  @ApiProperty()
  ordre: number;

  @ApiProperty()
  libelle: string;

  @ApiProperty({ description: 'Montant de la tranche, en FCFA.' })
  montant: number;

  @ApiProperty({ description: 'Part du solde imputée à cette tranche.' })
  regle: number;

  @ApiProperty({
    description:
      'Part déjà versée par la personne mais pas encore validée — un ' +
      'justificatif en cours d’examen, un paiement en ligne en attente. Elle ' +
      'n’est pas comptée dans « regle » tant qu’elle n’est pas reconnue.',
  })
  enAttente: number;

  @ApiProperty({
    description: 'Part de la tranche réellement réglée, en pourcentage.',
  })
  pourcentage: number;

  @ApiProperty({ format: 'date-time' })
  dateLimite: string;

  @ApiProperty({
    description: 'Vrai quand la tranche est intégralement payée.',
  })
  soldee: boolean;

  /** Échéance dépassée alors que la tranche n'est pas soldée. */
  @ApiProperty()
  enRetard: boolean;
}

export class Avancement {
  @ApiProperty()
  montantDu: number;

  @ApiProperty()
  montantRegle: number;

  @ApiProperty({ description: 'Reste à verser, jamais négatif.' })
  montantRestant: number;

  @ApiProperty({
    description:
      'Total des règlements lancés mais pas encore reconnus. Il n’est pas ' +
      'compté dans « montantRegle », mais il est déjà engagé : on ne peut pas ' +
      'le payer une seconde fois.',
  })
  montantEnAttente: number;

  @ApiProperty({ description: 'Progression en pourcentage, arrondie.' })
  pourcentage: number;

  @ApiProperty({ type: [AvancementTranche] })
  tranches: AvancementTranche[];

  /** Vrai dès qu'une échéance est dépassée sans être couverte. */
  @ApiProperty()
  enRetard: boolean;
}

/**
 * Répartit un solde sur les tranches, dans l'ordre.
 *
 * C'est le cœur du modèle, et la raison pour laquelle un versement n'est pas
 * rattaché à une tranche précise. La personne verse ce qu'elle veut quand elle
 * veut ; le solde remplit les tranches l'une après l'autre. On obtient ainsi
 * l'affichage attendu — « première tranche réglée, deuxième à moitié » — tout
 * en acceptant un versement à cheval sur deux échéances, ou le règlement
 * intégral d'un coup, que le bureau doit permettre.
 *
 * Le retard se lit à l'échéance de chaque tranche : elle est en retard si sa
 * date est passée et qu'elle n'est pas soldée. Comparer le cumul plutôt que
 * chaque tranche isolément évite de déclarer en retard quelqu'un qui a versé
 * d'avance.
 *
 * **Le réglé et l'en-attente se répartissent séparément.** Le réglé décide du
 * retard et du solde ; l'en-attente, lui, dit où iront les versements dont la
 * validation est encore attendue. Les empiler sur le réglé donne, tranche par
 * tranche, ce qui est déjà engagé — et donc ce qu'il reste réellement à
 * proposer au paiement, sans jamais laisser régler deux fois la même part.
 *
 * Fonction pure : elle ne lit ni base ni horloge en dehors de `maintenant`,
 * passé en paramètre pour que les tests décident du moment.
 */
export function calculerAvancement(
  montantDu: number,
  montantRegle: number,
  tranches: TrancheCotisation[],
  maintenant: Date = new Date(),
  montantEnAttente = 0,
): Avancement {
  const ordonnees = [...tranches].sort((a, b) => a.ordre - b.ordre);
  const enAttenteTotal = Math.max(0, montantEnAttente);

  let reste = montantRegle;
  let resteEngage = montantRegle + enAttenteTotal;
  const detail = ordonnees.map((tranche) => {
    // Ce que cette tranche absorbe du solde restant : tout ce qu'elle vaut si
    // le solde le permet, sinon ce qu'il en demeure.
    const impute = Math.max(0, Math.min(reste, tranche.montant));
    reste -= impute;

    // Même répartition, en y ajoutant ce qui attend sa validation : la
    // différence est la part « en attente » de cette tranche.
    const engage = Math.max(0, Math.min(resteEngage, tranche.montant));
    resteEngage -= engage;

    const soldee = impute >= tranche.montant;

    return {
      ordre: tranche.ordre,
      libelle: tranche.libelle,
      montant: tranche.montant,
      regle: impute,
      enAttente: engage - impute,
      pourcentage:
        tranche.montant > 0
          ? Math.min(100, Math.round((impute / tranche.montant) * 100))
          : 100,
      dateLimite: tranche.dateLimite.toISOString(),
      soldee,
      enRetard: !soldee && tranche.dateLimite.getTime() <= maintenant.getTime(),
    };
  });

  const montantRestant = Math.max(0, montantDu - montantRegle);

  return {
    montantDu,
    montantRegle,
    montantRestant,
    montantEnAttente: enAttenteTotal,
    // Bornée à cent : un versement excédentaire ne doit pas afficher 130 %,
    // qui laisserait croire à une erreur de saisie plutôt qu'à un trop-perçu.
    pourcentage:
      montantDu > 0
        ? Math.min(100, Math.round((montantRegle / montantDu) * 100))
        : 100,
    tranches: detail,
    enRetard: detail.some((tranche) => tranche.enRetard),
  };
}
