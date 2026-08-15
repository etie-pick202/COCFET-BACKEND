import { ApiProperty } from '@nestjs/swagger';
import { Vote } from './entities/vote.entity';

/** Libellé du segment réunissant ceux qui n'ont pas de promotion. */
export const SEGMENT_SANS_PROMOTION = 'Visiteurs';

export class ChoixExprime {
  @ApiProperty()
  id: string;

  @ApiProperty()
  texte: string;
}

export class Bulletin {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  prenom: string;

  @ApiProperty()
  nom: string;

  @ApiProperty({ nullable: true })
  promotion: number | null;

  @ApiProperty({ type: [ChoixExprime] })
  choix: ChoixExprime[];
}

export class OptionSegmentee {
  @ApiProperty()
  id: string;

  @ApiProperty()
  texte: string;

  @ApiProperty()
  votes: number;

  @ApiProperty({ description: 'Part des votants du segment, arrondie.' })
  pourcentage: number;
}

export class SegmentDepouillement {
  @ApiProperty({
    description: 'Promotion, ou « Visiteurs » pour ceux qui n’en ont pas.',
  })
  segment: string;

  @ApiProperty({ description: 'Nombre de votants de ce segment.' })
  votants: number;

  @ApiProperty({ type: [OptionSegmentee] })
  options: OptionSegmentee[];
}

/**
 * Dépouille un scrutin nominatif : qui a voté quoi, et comment se répartissent
 * les voix par population.
 *
 * **Ne s'applique jamais à un sondage anonyme.** Le bulletin y est délibérément
 * détaché de son auteur ; le recomposer par recoupement — un segment d'une
 * seule personne suffit à trahir son choix — viderait la promesse de son sens.
 * L'appelant doit donc écarter ce cas avant d'arriver ici, et le service le
 * refuse.
 *
 * Le segment est la **promotion**, ceux qui n'en ont pas étant réunis sous
 * « Visiteurs » : c'est le découpage que le bureau lit — 2027 contre 2028 — là
 * où le rôle mélangerait un finissant et un alumni de la même année.
 *
 * Les pourcentages sont calculés **sur les votants du segment**, non sur
 * l'ensemble : dire qu'une option pèse 8 % du total ne dit rien de ce que
 * pense la promotion concernée, qui est précisément la question posée.
 *
 * Fonction pure : elle ne lit ni base ni horloge, ce qui la rend éprouvable
 * sans montage.
 */
export function depouiller(votes: Vote[]): {
  bulletins: Bulletin[];
  repartition: SegmentDepouillement[];
} {
  const bulletins: Bulletin[] = votes
    .filter((vote) => vote.user !== null)
    .map((vote) => ({
      userId: vote.user!.id,
      prenom: vote.user!.firstName,
      nom: vote.user!.lastName,
      promotion: vote.user!.promotion,
      choix: (vote.options ?? []).map((option) => ({
        id: option.id,
        texte: option.texte,
      })),
    }));

  const segments = new Map<
    string,
    {
      votants: number;
      parOption: Map<string, { texte: string; votes: number }>;
    }
  >();

  for (const bulletin of bulletins) {
    const cle = bulletin.promotion?.toString() ?? SEGMENT_SANS_PROMOTION;
    const segment = segments.get(cle) ?? {
      votants: 0,
      parOption: new Map<string, { texte: string; votes: number }>(),
    };

    // Compte des **votants**, pas des choix : sur un scrutin à choix multiple,
    // additionner les choix rendrait les pourcentages incomparables d'un
    // segment à l'autre.
    segment.votants += 1;

    for (const choix of bulletin.choix) {
      const compte = segment.parOption.get(choix.id) ?? {
        texte: choix.texte,
        votes: 0,
      };
      compte.votes += 1;
      segment.parOption.set(choix.id, compte);
    }

    segments.set(cle, segment);
  }

  const repartition = [...segments.entries()]
    .map(([segment, donnees]) => ({
      segment,
      votants: donnees.votants,
      options: [...donnees.parOption.entries()]
        .map(([id, compte]) => ({
          id,
          texte: compte.texte,
          votes: compte.votes,
          pourcentage: Math.round((compte.votes / donnees.votants) * 100),
        }))
        .sort((a, b) => b.votes - a.votes),
    }))
    // Les promotions d'abord, par ordre croissant, « Visiteurs » en dernier :
    // le bureau lit d'abord les siens.
    .sort((a, b) => {
      if (a.segment === SEGMENT_SANS_PROMOTION) return 1;
      if (b.segment === SEGMENT_SANS_PROMOTION) return -1;
      return a.segment.localeCompare(b.segment);
    });

  return { bulletins, repartition };
}
