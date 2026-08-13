import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import {
  DemandePaiement,
  EntetesWebhook,
  EvenementPaiement,
  PasserellePaiement,
  ResultatPaiement,
} from '../ports/passerelle-paiement';

/** Montant minimal accepté par Fapshi, en FCFA. */
const MONTANT_MINIMAL = 100;

/** En-tête portant le secret de webhook, tel que Fapshi le nomme. */
const ENTETE_SECRET = 'x-wh-secret';

/**
 * Refus opposé par Fapshi, avec le code qui l'accompagne.
 *
 * Interne à l'adaptateur : le port ne connaît pas les codes HTTP d'un
 * prestataire. Elle n'existe que pour permettre de distinguer un refus
 * rattrapable — `direct-pay` non activé — de ceux qui ne le sont pas.
 */
class RefusFapshi extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Durée pendant laquelle on cesse de proposer `direct-pay` après un refus.
 *
 * Sans cette mémoire, chaque commande paierait un aller-retour HTTP inutile
 * avant de se rabattre. Bornée dans le temps plutôt que définitive : le jour
 * où Fapshi active la fonction, la plateforme s'en aperçoit seule, sans
 * redémarrage ni intervention.
 */
const MEMOIRE_REFUS_MS = 30 * 60_000;

/**
 * Adaptateur Fapshi, en paiement direct.
 *
 * `POST /direct-pay` envoie la demande sur le téléphone du payeur : pas de
 * page intermédiaire, ce qui correspond à un parcours où l'on connaît déjà le
 * numéro et l'opérateur. La contrepartie est qu'il n'y a pas de redirection à
 * suivre, et que l'issue arrive par notification ou par interrogation.
 *
 * **Fapshi ne signe pas ses notifications.** Elle renvoie un secret statique
 * dans un en-tête, à comparer au nôtre. Ce secret prouve que l'appelant le
 * connaît, pas que *ce corps-là* vient de Fapshi : qui le récupère — un
 * journal, une capture — peut forger un « paiement réussi » et se faire
 * délivrer un billet. L'en-tête sert donc de premier filtre, et le statut
 * retenu est ensuite **redemandé à Fapshi**. Une notification forgée ne
 * survit pas à cette seconde question.
 *
 * La correspondance des statuts est volontairement stricte : un libellé
 * inconnu lève au lieu d'être rangé par défaut. Traiter comme « payé » ce
 * qu'on ne comprend pas est la façon la plus directe de livrer des billets
 * non réglés.
 */
@Injectable()
export class PasserelleFapshi implements PasserellePaiement {
  private readonly logger = new Logger(PasserelleFapshi.name);
  private readonly baseUrl: string;
  private readonly apiUser: string;
  private readonly apiKey: string;
  private readonly secretWebhook: string;
  private readonly urlRetour: string;

  /** Au-delà, on rend la main : l'appelant tient une requête HTTP ouverte. */
  private static readonly DELAI_MS = 15_000;

  /** Instant du dernier refus de `direct-pay`, pour ne pas le rejouer en vain. */
  private refuseDepuis: number | null = null;

  constructor(config: ConfigService) {
    // Le bac à sable et la production ne diffèrent que par cette URL et par
    // les identifiants : le même code sert aux deux, ce qui évite d'avoir un
    // chemin de production jamais éprouvé.
    this.baseUrl = config.get<string>(
      'FAPSHI_BASE_URL',
      'https://sandbox.fapshi.com',
    );
    this.apiUser = config.getOrThrow<string>('FAPSHI_API_USER');
    this.apiKey = config.getOrThrow<string>('FAPSHI_API_KEY');
    this.secretWebhook = config.getOrThrow<string>('FAPSHI_WEBHOOK_SECRET');

    // Page vers laquelle Fapshi renvoie le payeur apres son reglement. Deduite
    // de CORS_ORIGIN, comme les liens des emails : c'est deja l'adresse du
    // frontal, et en tenir une seconde inviterait a les laisser diverger.
    // « FAPSHI_REDIRECT_URL » permet d'en decider autrement.
    this.urlRetour =
      config.get<string>('FAPSHI_REDIRECT_URL') ??
      `${config.get<string>('CORS_ORIGIN', 'http://localhost:5173').split(',')[0]}/paiement/retour`;
  }

  async initier(demande: DemandePaiement): Promise<ResultatPaiement> {
    if (!Number.isInteger(demande.montant)) {
      // Le FCFA n'a pas de sous-unité : une décimale produirait un écart
      // silencieux avec le relevé du prestataire.
      throw new BadRequestException('Le montant doit être un entier.');
    }
    if (demande.montant < MONTANT_MINIMAL) {
      // Contrôlé ici plutôt que laissé au prestataire : son refus arriverait
      // en 400 générique, sans dire à l'utilisateur ce qui cloche.
      throw new BadRequestException(
        `Le montant minimal est de ${MONTANT_MINIMAL} FCFA.`,
      );
    }

    if (this.directPayIndisponible()) {
      return this.parLienDePaiement(demande);
    }

    let corps: Record<string, unknown>;

    try {
      corps = await this.appeler('POST', '/direct-pay', {
        amount: demande.montant,
        phone: this.numeroLocal(demande.telephone),
        medium: this.canal(demande.methode),
        // Notre référence voyage jusqu'à la notification : c'est elle qui
        // permet de retrouver l'inscription au retour, sans table de
        // correspondance à tenir.
        externalId: demande.reference,
        message: demande.description,
      });
    } catch (erreur) {
      // **Le repli n'a lieu que sur un 403.** Fapshi a alors refusé la demande
      // avant de la créer : rien n'existe chez elle, et rejouer par un autre
      // canal ne peut pas débiter deux fois. Sur un délai dépassé ou une
      // coupure réseau, l'état est **inconnu** — la demande a peut-être
      // abouti — et un second appel risquerait un double débit. On lève.
      if (!(erreur instanceof RefusFapshi) || erreur.statut !== 403) {
        throw this.enException(erreur);
      }

      this.refuseDepuis = Date.now();
      this.logger.warn(
        'direct-pay refusé par Fapshi : repli automatique sur le lien de ' +
          'paiement. Voir https://www.fapshi.com/en/help-and-support/how-to-activate-direct-pay-for-your-fapshi-api ' +
          'pour faire activer le paiement direct.',
      );

      return this.parLienDePaiement(demande);
    }

    const transId = this.chaine(corps, ['transId']);
    if (!transId) {
      this.logger.error(
        `Réponse Fapshi sans transId : ${JSON.stringify(corps).slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Réponse inattendue du service de paiement.',
      );
    }

    return {
      reference: demande.reference,
      referenceExterne: transId,
      // `direct-pay` accuse réception sans trancher : le payeur doit encore
      // valider sur son téléphone. Annoncer autre chose qu'une attente ferait
      // confirmer un billet avant tout débit.
      statut: StatutPaiement.EN_ATTENTE,
      // Aucune page à ouvrir : c'est tout l'intérêt du paiement direct.
      urlRedirection: null,
    };
  }

  /**
   * Repli : `initiate-pay`, que Fapshi n'exige pas d'activer.
   *
   * Fapshi rend un lien de paiement hébergé. Le payeur y choisit lui-même son
   * opérateur et saisit son numéro — d'où l'absence de `phone` et de `medium`
   * ici, que la page demandera. Le parcours a une étape de plus que le
   * paiement direct, mais il encaisse, ce qui vaut mieux qu'un refus.
   *
   * L'appelant reconnaît ce mode à `urlRedirection`, non nulle : c'est vers
   * cette page qu'il doit envoyer le payeur.
   */
  private async parLienDePaiement(
    demande: DemandePaiement,
  ): Promise<ResultatPaiement> {
    let corps: Record<string, unknown>;

    try {
      corps = await this.appeler('POST', '/initiate-pay', {
        amount: demande.montant,
        externalId: demande.reference,
        message: demande.description,
        // Ramene le payeur chez nous une fois la page de Fapshi quittee. La
        // reference voyage avec lui : la page de retour sait alors quoi
        // interroger, sans quoi elle ne pourrait qu'afficher un message vague.
        //
        // **Ce retour ne prouve rien.** Le payeur peut fermer l'onglet avant,
        // ou forger l'URL. Seuls le webhook et la reconciliation font foi ;
        // cette page ne sert qu'a ne pas l'abandonner sur un site tiers.
        redirectUrl: `${this.urlRetour}?reference=${encodeURIComponent(demande.reference)}`,
      });
    } catch (erreur) {
      throw this.enException(erreur);
    }

    const transId = this.chaine(corps, ['transId']);
    const lien = this.chaine(corps, ['link']);

    if (!transId || !lien) {
      this.logger.error(
        `Réponse Fapshi sans transId ni lien : ${JSON.stringify(corps).slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Réponse inattendue du service de paiement.',
      );
    }

    return {
      reference: demande.reference,
      referenceExterne: transId,
      statut: StatutPaiement.EN_ATTENTE,
      urlRedirection: lien,
    };
  }

  /** Vrai tant que le refus de `direct-pay` est encore frais. */
  private directPayIndisponible(): boolean {
    return (
      this.refuseDepuis !== null &&
      Date.now() - this.refuseDepuis < MEMOIRE_REFUS_MS
    );
  }

  /**
   * Interroge Fapshi sur une transaction.
   *
   * ⚠️ Plafonné par le prestataire à six appels par minute et par
   * transaction : toute boucle de réconciliation doit s'y tenir, sous peine
   * de 429 en rafale.
   */
  async verifier(transId: string): Promise<ResultatPaiement> {
    let corps: Record<string, unknown>;

    try {
      corps = await this.appeler(
        'GET',
        `/payment-status/${encodeURIComponent(transId)}`,
      );
    } catch (erreur) {
      throw this.enException(erreur);
    }

    return {
      // La référence faisant foi est celle que Fapshi nous renvoie, pas celle
      // que l'appelant croyait interroger.
      reference: this.chaine(corps, ['externalId']) ?? transId,
      referenceExterne: this.chaine(corps, ['transId']) ?? transId,
      statut: this.versStatut(this.chaine(corps, ['status'])),
      urlRedirection: null,
    };
  }

  async interpreterWebhook(
    corpsBrut: Buffer,
    entetes: EntetesWebhook,
  ): Promise<EvenementPaiement> {
    if (!this.secretValide(entetes)) {
      throw new BadRequestException('Notification non authentifiée.');
    }

    const charge = this.analyser(corpsBrut);
    const transId = this.chaine(charge, ['transId']);
    if (!transId) {
      throw new BadRequestException('Notification sans transaction.');
    }

    // Le corps n'est pas cru sur parole : le secret d'en-tête ne le protège
    // pas, seule la réponse de Fapshi fait foi. C'est ce second appel qui
    // rend une notification forgée inoffensive.
    const verifie = await this.verifier(transId);

    return {
      reference: verifie.reference,
      referenceExterne: verifie.referenceExterne,
      statut: verifie.statut,
    };
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  /**
   * Traduit un refus interne en exception HTTP.
   *
   * Le port ne connaît pas les codes d'un prestataire : ils s'arrêtent à la
   * frontière de l'adaptateur.
   */
  private enException(erreur: unknown): Error {
    return erreur instanceof RefusFapshi
      ? new BadGatewayException(erreur.message)
      : (erreur as Error);
  }

  private async appeler(
    methode: 'GET' | 'POST',
    chemin: string,
    corps?: unknown,
  ): Promise<Record<string, unknown>> {
    let reponse: Response;

    try {
      reponse = await fetch(`${this.baseUrl}${chemin}`, {
        method: methode,
        headers: {
          apiuser: this.apiUser,
          apikey: this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(PasserelleFapshi.DELAI_MS),
      });
    } catch (erreur) {
      // Réseau coupé ou délai dépassé : l'état du paiement est **inconnu**, et
      // surtout pas « échoué ». L'appelant doit pouvoir le vérifier plus tard.
      this.logger.error(
        `Fapshi injoignable (${methode} ${chemin}) : ${(erreur as Error).message}`,
      );
      // Statut 0 : aucune reponse recue. L'etat du paiement est inconnu, et
      // surtout pas refuse — c'est ce qui interdit tout repli automatique.
      throw new RefusFapshi(
        0,
        'Le service de paiement est momentanément injoignable. Réessayez.',
      );
    }

    const charge = (await reponse.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!reponse.ok) {
      // 403 mérite un mot : c'est ce que renvoie Fapshi quand les
      // identifiants sont faux **ou** quand l'IP appelante n'est pas sur la
      // liste blanche du service. Les deux se ressemblent dans les journaux.
      if (reponse.status === 403) {
        // Le corps porte le motif exact — « invalid credentials » d'un côté,
        // une mention de l'adresse appelante de l'autre. Sans lui, les deux
        // causes sont indiscernables et le diagnostic repart de zéro, ce qui
        // a déjà coûté une panne de paiement en production.
        this.logger.error(
          'Fapshi a répondu 403 : identifiants invalides, ou IP du serveur ' +
            `absente de la liste blanche du service. Motif rendu : ${JSON.stringify(charge).slice(0, 300)}`,
        );
      } else {
        this.logger.error(
          `Fapshi a répondu ${reponse.status} : ${JSON.stringify(charge).slice(0, 300)}`,
        );
      }

      throw new RefusFapshi(
        reponse.status,
        'Le paiement n’a pas pu être traité. Réessayez dans un instant.',
      );
    }

    return charge;
  }

  /**
   * Statuts Fapshi : CREATED, PENDING, SUCCESSFUL, FAILED, EXPIRED.
   *
   * `EXPIRED` est rangé avec les échecs : la place doit être rendue, et
   * l'attendre indéfiniment la bloquerait pour tout le monde.
   */
  private versStatut(statut?: string): StatutPaiement {
    switch (statut?.toUpperCase()) {
      case 'SUCCESSFUL':
        return StatutPaiement.COMPLETE;
      case 'CREATED':
      case 'PENDING':
        return StatutPaiement.EN_ATTENTE;
      case 'FAILED':
      case 'EXPIRED':
        return StatutPaiement.ECHOUE;
      default:
        this.logger.error(`Statut Fapshi inconnu : « ${statut ?? 'absent'} »`);
        throw new BadGatewayException(
          'Réponse inattendue du service de paiement.',
        );
    }
  }

  /** Libellés attendus par `direct-pay`. */
  private canal(methode: MethodePaiement): string {
    return methode === MethodePaiement.ORANGE_MONEY
      ? 'orange money'
      : 'mobile money';
  }

  /**
   * Ramène un numéro au format attendu : neuf chiffres, sans indicatif.
   *
   * Nos DTO acceptent la forme internationale, que Fapshi refuse. Convertir
   * ici plutôt que d'imposer un format aux appelants évite de propager une
   * contrainte de prestataire dans tout le domaine.
   */
  private numeroLocal(telephone: string): string {
    const chiffres = telephone.replace(/\D/g, '').replace(/^237/, '');

    if (chiffres.length !== 9) {
      throw new BadRequestException(
        'Numéro invalide : neuf chiffres attendus, ex. 670000000.',
      );
    }

    return chiffres;
  }

  private secretValide(entetes: EntetesWebhook): boolean {
    const brut = entetes[ENTETE_SECRET];
    const fourni = Array.isArray(brut) ? brut[0] : brut;

    if (!fourni) {
      return false;
    }

    const attendu = Buffer.from(this.secretWebhook);
    const presente = Buffer.from(fourni.trim());

    // Comparaison à temps constant : une comparaison ordinaire s'arrête au
    // premier octet différent, et le temps de réponse laisse reconstruire le
    // secret caractère par caractère.
    return (
      attendu.length === presente.length && timingSafeEqual(attendu, presente)
    );
  }

  private analyser(corpsBrut: Buffer): Record<string, unknown> {
    try {
      return JSON.parse(corpsBrut.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Corps de notification illisible.');
    }
  }

  private chaine(
    source: Record<string, unknown>,
    cles: string[],
  ): string | undefined {
    for (const cle of cles) {
      const valeur = source[cle];
      if (typeof valeur === 'string' && valeur.length > 0) {
        return valeur;
      }
    }
    return undefined;
  }
}
