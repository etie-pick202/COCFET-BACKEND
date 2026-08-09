import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Stockage } from '../file/ports/stockage';
import { STOCKAGE } from '../file/ports/stockage';
import { GenerationService } from './generation.service';

/**
 * Charte du mandat en cours, prête à être posée sur un document.
 *
 * `logo` porte les **octets**, jamais une URL : c'est ce qui permet de le
 * joindre à un email ou de l'incruster dans un PDF sans dépendre d'un lien
 * qui expire.
 */
export interface IdentiteVisuelle {
  /** Nom du mandat, tel que la plateforme l'affiche. */
  nom: string;
  annee: number | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
  /**
   * Couleur de texte lisible posée sur {@link couleurPrimaire}.
   *
   * Un bureau peut choisir un jaune vif : du blanc dessus ne se lit plus. La
   * couleur est déduite de la luminance du fond plutôt que fixée, pour que le
   * bandeau reste lisible quel que soit le mandat.
   */
  contrastePrimaire: string;
  logo: Buffer | null;
}

/** Couleurs de repli, quand aucun mandat n'est actif. */
const CHARTE_NEUTRE = {
  nom: 'COCFET',
  annee: null,
  couleurPrimaire: '#0F172A',
  couleurSecondaire: '#D4AF37',
  contrastePrimaire: '#FFFFFF',
  logo: null,
} satisfies IdentiteVisuelle;

/** Notation hexadécimale, seule forme acceptée en base comme en sortie. */
const MOTIF_HEXA = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Ramène une couleur de la base à une valeur hexadécimale sûre.
 *
 * La colonne est un `varchar` libre : rien n'empêche d'y trouver
 * `red; background-image: url(...)`. Posée telle quelle dans un attribut
 * `style` d'email ou dans un PDF, elle porterait autre chose qu'une couleur.
 * Une valeur qui n'est pas un hexadécimal est donc remplacée, jamais échappée
 * — le bureau verra la couleur de repli et corrigera sa saisie.
 */
export function normaliserCouleur(
  valeur: string | null | undefined,
  repli: string,
): string {
  return valeur && MOTIF_HEXA.test(valeur.trim()) ? valeur.trim() : repli;
}

/**
 * Rend le noir ou le blanc, selon lequel se lit sur `fond`.
 *
 * Suit le calcul de luminance relative du WCAG : un seuil sur la moyenne des
 * composantes se tromperait sur les verts, que l'œil perçoit bien plus clairs
 * que les bleus à valeur égale.
 */
export function couleurTexteSur(fond: string): string {
  const hexa = fond.slice(1);
  const complet =
    hexa.length === 3
      ? hexa
          .split('')
          .map((c) => c + c)
          .join('')
      : hexa;

  const canal = (position: number): number => {
    const composante =
      parseInt(complet.slice(position, position + 2), 16) / 255;
    return composante <= 0.03928
      ? composante / 12.92
      : ((composante + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);

  return luminance > 0.45 ? '#111827' : '#FFFFFF';
}

/** Durée de vie du cache, en millisecondes. */
const DUREE_CACHE = 5 * 60_000;

/**
 * Fournit la charte du bureau à tout ce qui sort de la plateforme.
 *
 * Emails et documents doivent porter le même logo et les mêmes couleurs que
 * le site : un reçu aux couleurs d'un mandat précédent est une incohérence
 * que le destinataire remarque avant nous.
 *
 * **Le résultat est mis en cache.** Sans cela, chaque email déclencherait une
 * requête en base et une lecture du stockage pour un logo qui change une fois
 * par mandat — soit une diffusion à trois cents personnes multipliant par
 * trois cents une lecture strictement identique.
 *
 * Ne lève jamais : une charte indisponible dégrade l'apparence d'un message,
 * elle ne doit pas empêcher son envoi.
 */
@Injectable()
export class IdentiteVisuelleService {
  private readonly logger = new Logger(IdentiteVisuelleService.name);

  private cache: { valeur: IdentiteVisuelle; expire: number } | null = null;

  constructor(
    private readonly generationService: GenerationService,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
  ) {}

  async charte(): Promise<IdentiteVisuelle> {
    if (this.cache && this.cache.expire > Date.now()) {
      return this.cache.valeur;
    }

    const valeur = await this.construire();
    this.cache = { valeur, expire: Date.now() + DUREE_CACHE };

    return valeur;
  }

  /** Vide le cache. À appeler quand le mandat ou son logo changent. */
  invalider(): void {
    this.cache = null;
  }

  private async construire(): Promise<IdentiteVisuelle> {
    let generation: Awaited<ReturnType<GenerationService['trouverActive']>> =
      null;

    try {
      generation = await this.generationService.trouverActive();
    } catch (erreur) {
      this.logger.warn(
        `Charte indisponible, repli sur les couleurs neutres : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
      return CHARTE_NEUTRE;
    }

    if (!generation) {
      // Plateforme fraîchement installée, ou entre deux mandats : les
      // messages doivent partir quand même.
      return CHARTE_NEUTRE;
    }

    const couleurPrimaire = normaliserCouleur(
      generation.couleurPrimaire,
      CHARTE_NEUTRE.couleurPrimaire,
    );

    return {
      nom: generation.nom,
      annee: generation.annee,
      couleurPrimaire,
      couleurSecondaire: normaliserCouleur(
        generation.couleurSecondaire,
        CHARTE_NEUTRE.couleurSecondaire,
      ),
      contrastePrimaire: couleurTexteSur(couleurPrimaire),
      logo: await this.lireLogo(generation.logo),
    };
  }

  /**
   * Lit le logo désigné par le mandat.
   *
   * Un échec rend `null` plutôt que de lever : un logo manquant produit un
   * message sans image, ce qui reste préférable à un message jamais envoyé.
   */
  private async lireLogo(cle: string | null): Promise<Buffer | null> {
    if (!cle) {
      return null;
    }

    try {
      return await this.stockage.telecharger(cle);
    } catch (erreur) {
      this.logger.warn(
        `Logo « ${cle} » illisible : les messages partiront sans image. ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
      return null;
    }
  }
}
