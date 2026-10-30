import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Role, estAdministrateur } from '../../common/enums/role.enum';
import { BureauService } from '../bureau/bureau.service';
import { appartientA, estDansDossier } from './propriete-fichier';

/**
 * Dossiers dont l'URL de lecture se délivre sans connexion.
 *
 * Ce sont les médias de pages elles-mêmes publiques : une actualité, une fiche
 * d'événement ou de produit, un logo de partenaire. Sans cette ouverture, un
 * visiteur non connecté voyait des pages sans images.
 */
export const DOSSIERS_PUBLICS = [
  'articles',
  'videos',
  'evenements',
  'produits',
  'sponsors',
  'logos',
] as const;

/**
 * Dossiers lisibles par tout membre connecté : les photos de profil, que
 * l'application affiche à côté des noms partout (commentaires, recherche,
 * bureau, annuaire), et les visuels soumis au vote.
 */
const DOSSIERS_MEMBRES = ['avatars', 'sondages'];

export interface Lecteur {
  id: string;
  role: Role;
}

/** Vrai quand la clé désigne un média de page publique. */
export function estCleDePagePublique(cle: unknown): boolean {
  // Un paramètre répété (« ?cle=a&cle=b ») arrive en tableau : ce n'est pas une clé.
  return DOSSIERS_PUBLICS.some((dossier) => estDansDossier(cle, dossier));
}

/**
 * Qui peut obtenir une URL de lecture pour quelle clé.
 *
 * Avant, tout compte connecté obtenait une URL pour n'importe quelle clé — CV
 * et justificatifs de paiement compris. Le seul rempart était qu'une clé
 * contient un identifiant aléatoire ; une clé qui circule suffisait à lire le
 * fichier. La règle dépend désormais du dossier :
 *
 * - médias de pages publiques : tout le monde ;
 * - photos et visuels de sondage : tout membre connecté ;
 * - CV : son auteur et l'administration (les partenaires passent par
 *   l'annuaire, qui décompte leur quota) ;
 * - justificatifs : leur auteur et les postes de la trésorerie ;
 * - tout le reste : l'administration.
 */
@Injectable()
export class AccesFichiers {
  constructor(
    private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
  ) {}

  async peutLire(cle: string, lecteur?: Lecteur): Promise<boolean> {
    if (estCleDePagePublique(cle)) {
      return true;
    }
    if (!lecteur) {
      return false;
    }

    const dossier = cle.split('/')[0];
    if (!estDansDossier(cle, dossier)) {
      return false;
    }
    if (DOSSIERS_MEMBRES.includes(dossier)) {
      return true;
    }
    if (lecteur.role === Role.SUPER_ADMIN) {
      return true;
    }

    switch (dossier) {
      case 'cv':
        return (
          estAdministrateur(lecteur.role) ||
          appartientA(cle, 'cv', lecteur.id) ||
          (await this.reference(
            'SELECT 1 FROM profils_finissants WHERE cv_url = $1 AND user_id = $2',
            cle,
            lecteur.id,
          ))
        );
      case 'justificatifs':
        return (
          appartientA(cle, 'justificatifs', lecteur.id) ||
          (await this.reference(
            'SELECT 1 FROM justificatifs_paiement WHERE cle = $1 AND user_id = $2',
            cle,
            lecteur.id,
          )) ||
          (await this.accedeTresorerie(lecteur.id))
        );
      default:
        return estAdministrateur(lecteur.role);
    }
  }

  /**
   * Les fichiers déposés avant que les clés portent leur auteur : on retrouve
   * leur titulaire par la fiche qui les référence.
   */
  private async reference(
    requete: string,
    cle: string,
    userId: string,
  ): Promise<boolean> {
    const lignes = await this.dataSource.query<unknown[]>(requete, [
      cle,
      userId,
    ]);
    return lignes.length > 0;
  }

  /**
   * Résolu à la demande : le module du bureau dépend, par le courrier, de
   * celui des fichiers, et l'importer ici formerait un cycle.
   */
  private async accedeTresorerie(userId: string): Promise<boolean> {
    const bureau = this.moduleRef.get(BureauService, { strict: false });
    return (await bureau.privilegesDe(userId)).accedeTresorerie;
  }
}
