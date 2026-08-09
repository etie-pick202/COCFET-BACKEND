import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import {
  JournalActivite,
  TypeActivite,
} from './entities/journal-activite.entity';

export interface EcritureActivite {
  type: TypeActivite;
  message: string;
  /** Qui a agi. Nul pour ce que la plateforme fait d'elle-même. */
  auteur?: User | null;
  /** Contexte utile à la relecture : identifiants, montants, références. */
  metadata?: Record<string, unknown>;
}

/**
 * Journal des faits marquants, destiné au flux du tableau de bord.
 *
 * **Aucune écriture ne peut faire échouer l'action qu'elle relate.** C'est la
 * seule règle qui compte ici : un journal indisponible doit rester un
 * inconvénient, jamais la cause d'une inscription refusée ou d'un paiement
 * non confirmé. Tout est donc avalé et signalé, sans jamais remonter.
 *
 * Le message est rédigé par l'appelant, en français et au passé : il est lu
 * tel quel par le bureau, sans traitement ni traduction.
 */
@Injectable()
export class ActiviteService {
  private readonly logger = new Logger(ActiviteService.name);

  constructor(
    @InjectRepository(JournalActivite)
    private readonly journal: Repository<JournalActivite>,
  ) {}

  async journaliser(ecriture: EcritureActivite): Promise<void> {
    try {
      await this.journal.save(
        this.journal.create({
          type: ecriture.type,
          message: ecriture.message,
          user: ecriture.auteur ?? null,
          metadata: ecriture.metadata ?? null,
        }),
      );
    } catch (erreur) {
      // Journalisé en avertissement et non en erreur : la donnée métier, elle,
      // est bien enregistrée. Seule sa trace manque.
      this.logger.warn(
        `Journal d'activité indisponible (${ecriture.type}) : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }
}
