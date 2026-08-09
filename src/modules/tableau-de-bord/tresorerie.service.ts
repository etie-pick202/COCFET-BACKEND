import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Inscription } from '../billetterie/entities/inscription.entity';
import { LigneCommande } from '../commande/entities/ligne-commande.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import {
  ClassementEntree,
  FiltreTransactionDto,
  MontantVentile,
  PeriodeDto,
  PointTemporel,
  TableauTresorerie,
} from './dto/tableau-de-bord.dto';
import { versCsv } from './export-csv';

/** Longueur des classements. Au-delà, un tableau de bord devient un rapport. */
const TAILLE_CLASSEMENT = 5;

/** Profondeur de la série temporelle, en mois. */
const MOIS_HISTORIQUE = 12;

/**
 * Indicateurs financiers, réservés aux postes qui ont la trésorerie en charge.
 *
 * Une règle gouverne tout ce fichier : **seuls les paiements aboutis
 * comptent**. Additionner les paiements en attente afficherait une recette
 * qui n'existe pas encore, et le premier rapprochement avec le relevé du
 * prestataire ferait conclure à un bug là où il n'y a qu'une convention mal
 * choisie.
 *
 * Les agrégats sont calculés par la base plutôt qu'en mémoire : ramener
 * toutes les transactions pour les additionner en JavaScript tiendrait tant
 * que le bureau est jeune, et s'écroulerait sans prévenir.
 */
@Injectable()
export class TresorerieService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(Inscription)
    private readonly inscriptions: Repository<Inscription>,
    @InjectRepository(LigneCommande)
    private readonly lignes: Repository<LigneCommande>,
  ) {}

  async tableau(periode: PeriodeDto): Promise<TableauTresorerie> {
    const [
      totaux,
      recettesDuMois,
      parOrigine,
      parMethode,
      parMois,
      meilleursEvenements,
      meilleursProduits,
      meilleursContributeurs,
    ] = await Promise.all([
      this.totaux(periode),
      this.recettesDuMoisEnCours(),
      this.ventilerParOrigine(periode),
      this.ventilerParMethode(periode),
      this.serieMensuelle(),
      this.classerEvenements(periode),
      this.classerProduits(periode),
      this.classerContributeurs(periode),
    ]);

    return {
      ...totaux,
      recettesDuMois,
      parOrigine,
      parMethode,
      parMois,
      meilleursEvenements,
      meilleursProduits,
      meilleursContributeurs,
    };
  }

  /** Journal brut, filtrable. C'est la pièce comptable, pas un indicateur. */
  async journal(filtre: FiltreTransactionDto): Promise<{
    donnees: Transaction[];
    meta: { page: number; limite: number; total: number; totalPages: number };
  }> {
    const page = filtre.page ?? 1;
    const limite = Math.min(filtre.limite ?? 20, 100);

    const requete = this.requeteFiltree(filtre);

    const [donnees, total] = await requete
      .orderBy('t.createdAt', 'DESC')
      .skip((page - 1) * limite)
      .take(limite)
      .getManyAndCount();

    return {
      donnees,
      meta: { page, limite, total, totalPages: Math.ceil(total / limite) },
    };
  }

  /**
   * Export destiné à la trésorerie du bureau.
   *
   * Non paginé, à l'inverse du journal : un export tronqué à vingt lignes ne
   * servirait à rien, et c'est bien la totalité de la période demandée qui
   * doit se retrouver dans le tableur. Les montants sortent en entiers, sans
   * séparateur ni symbole — le FCFA n'a pas de sous-unité, et un « 12 000 »
   * formaté serait relu comme du texte par Excel.
   */
  async exporterCsv(filtre: FiltreTransactionDto): Promise<string> {
    const transactions = await this.requeteFiltree(filtre)
      .orderBy('t.createdAt', 'DESC')
      .getMany();

    return versCsv(
      [
        'Date',
        'Reference',
        'Reference prestataire',
        'Origine',
        'Statut',
        'Methode',
        'Montant FCFA',
        'Compte',
      ],
      transactions.map((t) => [
        t.createdAt.toISOString(),
        t.reference,
        t.referenceExterne,
        t.origine,
        t.statut,
        t.methodePaiement,
        t.montant,
        t.user ? `${t.user.firstName} ${t.user.lastName}` : '',
      ]),
    );
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  /**
   * Requête du journal, filtres appliqués.
   *
   * Partagée entre la consultation paginée et l'export : c'est la **même**
   * sélection qui doit alimenter les deux, sans quoi le tableur ne
   * contiendrait pas ce que l'écran affiche. Deux copies auraient divergé au
   * premier filtre ajouté d'un seul côté.
   */
  private requeteFiltree(
    filtre: FiltreTransactionDto,
  ): SelectQueryBuilder<Transaction> {
    const requete = this.transactions
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.user', 'u');

    this.borner(requete, 't', filtre);

    if (filtre.origine) {
      requete.andWhere('t.origine = :origine', { origine: filtre.origine });
    }
    if (filtre.statut) {
      requete.andWhere('t.statut = :statut', { statut: filtre.statut });
    }
    if (filtre.methodePaiement) {
      requete.andWhere('t.methodePaiement = :methode', {
        methode: filtre.methodePaiement,
      });
    }

    return requete;
  }

  private async totaux(periode: PeriodeDto) {
    const compter = async (statut: StatutPaiement): Promise<number> => {
      const requete = this.transactions
        .createQueryBuilder('t')
        .where('t.statut = :statut', { statut });
      this.borner(requete, 't', periode);
      return requete.getCount();
    };

    const requete = this.transactions
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.montant), 0)', 'somme')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE });
    this.borner(requete, 't', periode);

    const brut = await requete.getRawOne<{ somme: string }>();
    const recettesTotales = Number(brut?.somme ?? 0);

    const [abouties, enAttente, echouees] = await Promise.all([
      compter(StatutPaiement.COMPLETE),
      compter(StatutPaiement.EN_ATTENTE),
      compter(StatutPaiement.ECHOUE),
    ]);

    return {
      recettesTotales,
      transactionsAbouties: abouties,
      transactionsEnAttente: enAttente,
      transactionsEchouees: echouees,
      // Division gardée : sans transaction aboutie, le panier moyen n'existe
      // pas — et « NaN » traverserait tout le frontend jusqu'à l'affichage.
      panierMoyen: abouties === 0 ? 0 : Math.round(recettesTotales / abouties),
    };
  }

  private async recettesDuMoisEnCours(): Promise<number> {
    const maintenant = new Date();
    const debut = new Date(
      Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1),
    );

    const brut = await this.transactions
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.montant), 0)', 'somme')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE })
      .andWhere('t.createdAt >= :debut', { debut })
      .getRawOne<{ somme: string }>();

    return Number(brut?.somme ?? 0);
  }

  private ventilerParOrigine(periode: PeriodeDto): Promise<MontantVentile[]> {
    return this.ventiler('t.origine', periode);
  }

  private ventilerParMethode(periode: PeriodeDto): Promise<MontantVentile[]> {
    return this.ventiler('t.methode_paiement', periode);
  }

  private async ventiler(
    colonne: string,
    periode: PeriodeDto,
  ): Promise<MontantVentile[]> {
    const requete = this.transactions
      .createQueryBuilder('t')
      .select(colonne, 'libelle')
      .addSelect('COALESCE(SUM(t.montant), 0)', 'montant')
      .addSelect('COUNT(*)', 'nombre')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE })
      .groupBy(colonne)
      .orderBy('montant', 'DESC');

    this.borner(requete, 't', periode);

    const lignes = await requete.getRawMany<{
      libelle: string | null;
      montant: string;
      nombre: string;
    }>();

    return lignes.map((ligne) => ({
      // Une méthode nulle existe : un événement gratuit ouvre une transaction
      // sans passer par un opérateur.
      libelle: ligne.libelle ?? 'NON_RENSEIGNE',
      montant: Number(ligne.montant),
      nombre: Number(ligne.nombre),
    }));
  }

  /**
   * Série des douze derniers mois.
   *
   * `date_trunc` regroupe côté base : découper les dates en JavaScript
   * supposerait de tout ramener, et ferait dépendre le résultat du fuseau du
   * serveur applicatif plutôt que de celui des données.
   */
  private async serieMensuelle(): Promise<PointTemporel[]> {
    const debut = new Date();
    debut.setUTCMonth(debut.getUTCMonth() - (MOIS_HISTORIQUE - 1));
    debut.setUTCDate(1);
    debut.setUTCHours(0, 0, 0, 0);

    const lignes = await this.transactions
      .createQueryBuilder('t')
      .select("to_char(date_trunc('month', t.created_at), 'YYYY-MM')", 'mois')
      .addSelect('COALESCE(SUM(t.montant), 0)', 'montant')
      .addSelect('COUNT(*)', 'nombre')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE })
      .andWhere('t.createdAt >= :debut', { debut })
      .groupBy("date_trunc('month', t.created_at)")
      .orderBy("date_trunc('month', t.created_at)", 'ASC')
      .getRawMany<{ mois: string; montant: string; nombre: string }>();

    return lignes.map((ligne) => ({
      mois: ligne.mois,
      montant: Number(ligne.montant),
      nombre: Number(ligne.nombre),
    }));
  }

  /**
   * Événements par recette.
   *
   * La somme porte sur `Inscription.prix`, le tarif **figé au moment de
   * l'inscription** : reprendre le prix courant de l'événement réécrirait
   * l'histoire à chaque changement de tarif.
   */
  private async classerEvenements(
    periode: PeriodeDto,
  ): Promise<ClassementEntree[]> {
    const requete = this.inscriptions
      .createQueryBuilder('i')
      .innerJoin('i.evenement', 'e')
      .select('e.id', 'id')
      .addSelect('e.titre', 'libelle')
      .addSelect('COALESCE(SUM(i.prix), 0)', 'montant')
      .addSelect('COUNT(*)', 'quantite')
      .where('i.statutPaiement = :statut', {
        statut: StatutPaiement.COMPLETE,
      })
      .groupBy('e.id')
      .addGroupBy('e.titre')
      .orderBy('montant', 'DESC')
      .limit(TAILLE_CLASSEMENT);

    this.borner(requete, 'i', periode);

    return this.versClassement(requete);
  }

  /** Produits par recette, prix unitaire figé à la ligne de commande. */
  private async classerProduits(
    periode: PeriodeDto,
  ): Promise<ClassementEntree[]> {
    const requete = this.lignes
      .createQueryBuilder('l')
      .innerJoin('l.produit', 'p')
      .innerJoin('l.commande', 'c')
      .select('p.id', 'id')
      .addSelect('p.nom', 'libelle')
      .addSelect('COALESCE(SUM(l.prix * l.quantite), 0)', 'montant')
      .addSelect('COALESCE(SUM(l.quantite), 0)', 'quantite')
      .where('c.statutPaiement = :statut', {
        statut: StatutPaiement.COMPLETE,
      })
      .groupBy('p.id')
      .addGroupBy('p.nom')
      .orderBy('montant', 'DESC')
      .limit(TAILLE_CLASSEMENT);

    this.borner(requete, 'c', periode);

    return this.versClassement(requete);
  }

  /** Comptes par dépense cumulée, billetterie et boutique confondues. */
  private async classerContributeurs(
    periode: PeriodeDto,
  ): Promise<ClassementEntree[]> {
    const requete = this.transactions
      .createQueryBuilder('t')
      .innerJoin('t.user', 'u')
      .select('u.id', 'id')
      .addSelect("CONCAT(u.first_name, ' ', u.last_name)", 'libelle')
      .addSelect('COALESCE(SUM(t.montant), 0)', 'montant')
      .addSelect('COUNT(*)', 'quantite')
      .where('t.statut = :statut', { statut: StatutPaiement.COMPLETE })
      .groupBy('u.id')
      .addGroupBy('u.first_name')
      .addGroupBy('u.last_name')
      .orderBy('montant', 'DESC')
      .limit(TAILLE_CLASSEMENT);

    this.borner(requete, 't', periode);

    return this.versClassement(requete);
  }

  private async versClassement(
    requete: SelectQueryBuilder<ObjectLiteral>,
  ): Promise<ClassementEntree[]> {
    const lignes = await requete.getRawMany<{
      id: string;
      libelle: string;
      montant: string;
      quantite: string;
    }>();

    return lignes.map((ligne) => ({
      id: ligne.id,
      libelle: ligne.libelle,
      montant: Number(ligne.montant),
      quantite: Number(ligne.quantite),
    }));
  }

  /**
   * Applique les bornes de période, quand elles sont fournies.
   *
   * Les paramètres sont nommés d'après l'alias : deux appels sur la même
   * requête — le cas des classements — écraseraient sinon leurs bornes
   * mutuellement.
   */
  private borner(
    requete: SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    periode: PeriodeDto,
  ): void {
    if (periode.depuis) {
      requete.andWhere(`${alias}.createdAt >= :depuis_${alias}`, {
        [`depuis_${alias}`]: new Date(periode.depuis),
      });
    }
    if (periode.jusqua) {
      requete.andWhere(`${alias}.createdAt <= :jusqua_${alias}`, {
        [`jusqua_${alias}`]: new Date(periode.jusqua),
      });
    }
  }
}
