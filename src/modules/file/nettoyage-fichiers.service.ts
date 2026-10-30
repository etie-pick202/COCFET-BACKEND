import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Stockage } from './ports/stockage';
import { estDansDossier } from './propriete-fichier';
import { STOCKAGE } from './ports/stockage';

/**
 * Efface du stockage les objets que plus rien ne référence.
 *
 * Sans cela, remplacer dix fois la photo d'un produit laisse dix objets
 * payants dans le seau, et **aucune purge ne peut les ramasser** : le stockage
 * ne sait pas distinguer un orphelin d'un fichier encore utile. Seul le module
 * qui détient la référence le sait, et seulement au moment où il la remplace.
 *
 * **Rien ne lève jamais.** Un échec d'effacement ne doit pas refuser à
 * l'utilisateur la modification qu'il a demandée : la base est déjà à jour, et
 * lui rendre une erreur laisserait croire que rien n'a été enregistré. L'objet
 * reste orphelin, le journal le dit, et cela se rattrape.
 *
 * L'ordre importe : **la base d'abord, le stockage ensuite**. Dans l'autre
 * sens, un échec de la base après un effacement réussi laisserait une
 * référence vers un objet disparu — une image cassée, qui se voit, là où un
 * orphelin ne coûte que quelques octets.
 */
@Injectable()
export class NettoyageFichiers {
  private readonly logger = new Logger(NettoyageFichiers.name);

  constructor(@Inject(STOCKAGE) private readonly stockage: Stockage) {}

  /**
   * Efface l'ancienne clé quand elle vient d'être remplacée.
   *
   * `nouvelle` à `undefined` signifie « champ absent de la demande » : le
   * fichier n'est pas remplacé, il ne faut rien effacer. À `null`, il est
   * retiré, et l'objet doit partir. La distinction est celle que font les DTO
   * de mise à jour partielle, et la confondre effacerait des fichiers que
   * personne n'a demandé de retirer.
   */
  async remplacer(
    ancienne: string | null | undefined,
    nouvelle: string | null | undefined,
    dossier?: string,
  ): Promise<void> {
    if (!ancienne || nouvelle === undefined || ancienne === nouvelle) {
      return;
    }

    if (dossier) {
      await this.retirerDuDossier(dossier, ancienne);
      return;
    }
    await this.retirer(ancienne);
  }

  /**
   * Retire un fichier personnel, à condition qu'il soit rangé là où il doit
   * l'être.
   *
   * Garde-fou en plus du contrôle à l'écriture : une valeur enregistrée avant
   * ce contrôle pourrait désigner le fichier de quelqu'un d'autre. Hors de son
   * dossier, la clé est laissée en place — mieux vaut un fichier orphelin que
   * l'effacement du logo du mandat.
   */
  async retirerDuDossier(
    dossier: string,
    cle: string | null | undefined,
  ): Promise<void> {
    if (!cle) {
      return;
    }
    const designee: string = cle;
    if (!estDansDossier(cle, dossier)) {
      this.logger.warn(
        `Fichier « ${designee} » laissé en place : il n'est pas rangé dans « ${dossier} ».`,
      );
      return;
    }

    await this.retirer(designee);
  }

  /**
   * Même chose pour une collection : efface celles qui ne sont plus citées.
   *
   * Un produit perd une photo sur cinq ; les quatre autres restent, et seule
   * la cinquième doit disparaître.
   */
  async remplacerLot(
    anciennes: string[] | null | undefined,
    nouvelles: string[] | null | undefined,
  ): Promise<void> {
    if (!anciennes?.length || nouvelles === undefined) {
      return;
    }

    const conservees = new Set(nouvelles ?? []);
    await this.retirer(...anciennes.filter((cle) => !conservees.has(cle)));
  }

  /** Efface les clés données, en ignorant les valeurs vides. */
  async retirer(...cles: (string | null | undefined)[]): Promise<void> {
    for (const cle of cles) {
      if (!cle) {
        continue;
      }

      try {
        await this.stockage.supprimer(cle);
      } catch (erreur) {
        this.logger.warn(
          `Fichier orphelin non supprimé (${cle}) : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }
  }
}
