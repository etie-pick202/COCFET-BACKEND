/**
 * Limiteur de débit tenu en mémoire, à fenêtre fixe.
 *
 * Le secours d'Upstash : quand le service distant ne répond plus — quota
 * mensuel épuisé, panne réseau — la limitation continue sur place plutôt que
 * de renvoyer une erreur 500 à chaque requête, ce qui rendait tout le site
 * inaccessible. L'API tourne sur une seule instance : un compteur local la
 * protège aussi bien de la force brute, le temps qu'Upstash revienne.
 */
export class LimiteurMemoire {
  /** Au-delà, les fenêtres échues sont purgées avant d'en ouvrir une autre. */
  private static readonly TAILLE_PURGE = 10_000;

  private readonly fenetres = new Map<
    string,
    { fin: number; compte: number }
  >();

  /** Vrai si la requête passe ; la compte au passage. */
  autoriser(
    cle: string,
    requetes: number,
    fenetreSecondes: number,
    maintenant = Date.now(),
  ): boolean {
    let fenetre = this.fenetres.get(cle);

    if (!fenetre || fenetre.fin <= maintenant) {
      this.purger(maintenant);
      fenetre = { fin: maintenant + fenetreSecondes * 1000, compte: 0 };
      this.fenetres.set(cle, fenetre);
    }

    fenetre.compte += 1;
    return fenetre.compte <= requetes;
  }

  private purger(maintenant: number): void {
    if (this.fenetres.size < LimiteurMemoire.TAILLE_PURGE) {
      return;
    }
    for (const [cle, fenetre] of this.fenetres) {
      if (fenetre.fin <= maintenant) {
        this.fenetres.delete(cle);
      }
    }
  }
}
