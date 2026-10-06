import {
  CharteFigee,
  ContenuDocument,
  ContenuFacture,
  ContenuFactureCotisation,
  ContenuRapport,
  ContenuRecu,
  LigneVentilation,
} from '../entities/contenu-document';
import {
  BORDURE,
  Cellule,
  ColonneTableau,
  dateLisible,
  ENCRE,
  ENCRE_DOUCE,
  enTete,
  etiquette,
  FILET,
  informations,
  LARGEUR_UTILE,
  MARGE,
  mention,
  montant,
  ouvrir,
  Page,
  periodeLisible,
  pied,
  POLICE,
  reserver,
  section,
  tableau,
  totaux,
} from './mise-en-page';

/**
 * Libellés des valeurs que le domaine range en énumérations.
 *
 * Une pièce se lit par un payeur ou un auditeur, pas par un développeur :
 * « MTN_MOMO » n'a rien à y faire. Une valeur absente de la table — ajoutée au
 * domaine après coup, ou figée dans un vieux document — se lit encore,
 * débarrassée de ses soulignés.
 */
const LIBELLES: Record<string, string> = {
  MTN_MOMO: 'MTN Mobile Money',
  ORANGE_MONEY: 'Orange Money',
  MOBILE_MONEY: 'Mobile Money',
  EVENEMENT: 'Billetterie',
  BILLETTERIE: 'Billetterie',
  BOUTIQUE: 'Boutique',
  COTISATION: 'Cotisations',
  JUSTIFICATIF: 'Preuve de paiement validée par la trésorerie',
};

const STATUTS: Record<string, string> = {
  COMPLETE: 'Payée',
  EN_ATTENTE: 'En attente',
  ECHOUE: 'Échouée',
};

export function libelle(valeur: string | null | undefined): string {
  if (!valeur) {
    return 'Non renseigné';
  }
  if (LIBELLES[valeur]) {
    return LIBELLES[valeur];
  }
  const texte = valeur.replaceAll('_', ' ').toLowerCase();
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/**
 * Compose le PDF d'un document à partir de son contenu figé.
 *
 * Aucune lecture du domaine ici : tout vient de `contenu`. C'est ce qui rend
 * la régénération fidèle des mois après l'émission, quand le produit a été
 * renommé et le mandat remplacé.
 *
 * `logo` arrive à part — les octets ne se rangent pas dans un `jsonb`. Nul,
 * le document se compose avec un monogramme à la place.
 */
export async function composer(
  contenu: ContenuDocument,
  numero: string,
  logo: Buffer | null,
): Promise<Buffer> {
  const { page, termine } = ouvrir();

  switch (contenu.genre) {
    case 'FACTURE_COMMANDE':
      composerFacture(page, contenu, numero, logo);
      break;
    case 'RECU_BILLETTERIE':
      composerRecu(page, contenu, numero, logo);
      break;
    case 'FACTURE_COTISATION':
      composerFactureCotisation(page, contenu, numero, logo);
      break;
    case 'RAPPORT_TRESORERIE':
      composerRapport(page, contenu, numero, logo);
      break;
  }

  pied(
    page,
    `${contenu.charte.nom} · COCFET — pièce ${numero} émise le ${dateLisible(contenu.emisLe)}`,
  );
  page.end();

  return termine;
}

/** Pastille de statut suivie du moyen de paiement. Rend sa hauteur. */
function reglement(
  charte: CharteFigee,
  statut: string,
  methode: string | null,
): (page: Page, x: number, y: number) => number {
  return (page, x, y) => {
    const texte = STATUTS[statut] ?? libelle(statut);
    page.font(POLICE.texteGras).fontSize(8.6);
    const largeur = page.widthOfString(texte) + 22;

    page.roundedRect(x, y, largeur, 15, 7.5).fill('#F5F2EC');
    page.circle(x + 9, y + 7.5, 2.2).fill(charte.couleurPrimaire);
    page.fillColor(ENCRE).text(texte, x + 15, y + 3.6, { lineBreak: false });
    page
      .font(POLICE.texte)
      .fontSize(9)
      .fillColor(ENCRE_DOUCE)
      .text(libelle(methode), x + largeur + 8, y + 3.4, { lineBreak: false });

    return 16;
  };
}

function composerFacture(
  page: Page,
  contenu: ContenuFacture,
  numero: string,
  logo: Buffer | null,
): void {
  const charte = contenu.charte;
  enTete(
    page,
    charte,
    logo,
    'Facture',
    numero,
    `Émise le ${dateLisible(contenu.emisLe)}`,
  );

  informations(page, [
    {
      cle: 'Facturé à',
      valeur: contenu.titulaire.nom,
      detail: contenu.titulaire.email,
    },
    {
      cle: 'Règlement',
      valeur: '',
      dessiner: reglement(
        charte,
        contenu.statutPaiement,
        contenu.methodePaiement,
      ),
    },
  ]);

  page.y += 30;
  tableau(
    page,
    [
      { titre: 'Désignation', part: 0.5 },
      { titre: 'Qté', part: 0.1, aDroite: true },
      { titre: 'Prix unitaire', part: 0.2, aDroite: true },
      { titre: 'Montant', part: 0.2, aDroite: true },
    ],
    contenu.lignes.map((ligne): Cellule[] => {
      // La désignation figée porte « produit · taille · couleur » : le nom en
      // tête, les variantes dessous, comme sur la maquette.
      const [nom, ...variantes] = ligne.designation.split(' · ');
      return [
        variantes.length > 0
          ? { texte: nom, detail: variantes.join(' · ') }
          : ligne.designation,
        String(ligne.quantite),
        montant(ligne.prixUnitaire),
        montant(ligne.prixUnitaire * ligne.quantite),
      ];
    }),
  );

  // Nulles sur une commande antérieure à la répercussion des frais : rien à
  // détailler, le total est alors le montant réglé.
  const detail = [{ libelle: 'Sous-total', valeur: montant(contenu.total) }];
  if (contenu.fraisFapshi !== null) {
    detail.push({
      libelle: 'Frais Fapshi',
      valeur: montant(contenu.fraisFapshi),
    });
  }
  if (contenu.fraisRetrait !== null) {
    detail.push({
      libelle: 'Frais de retrait',
      valeur: montant(contenu.fraisRetrait),
    });
  }
  totaux(page, charte, detail, {
    libelle: 'Montant réglé',
    valeur: montant(contenu.montantTtc ?? contenu.total),
  });

  mention(
    page,
    'Retrait des articles sur le campus de l’institut Ucac-Icam, après ' +
      'confirmation par le bureau. Cette facture est délivrée par le Comité ' +
      'd’Organisation de la Cérémonie de Fin d’Étude et ne vaut pas facture ' +
      'fiscale.',
    42,
  );
}

function composerRecu(
  page: Page,
  contenu: ContenuRecu,
  numero: string,
  logo: Buffer | null,
): void {
  const charte = contenu.charte;
  enTete(
    page,
    charte,
    logo,
    'Facture',
    numero,
    `Émise le ${dateLisible(contenu.emisLe)}`,
  );

  informations(page, [
    {
      cle: 'Facturé à',
      valeur: contenu.titulaire.nom,
      detail: contenu.titulaire.email,
    },
    {
      cle: 'Règlement',
      valeur: libelle(contenu.methodePaiement),
    },
  ]);

  // Carte de l'événement.
  const haut = page.y + 25;
  const largeurColonne = (LARGEUR_UTILE - 39 - 2 * 15) / 3;
  page.font(POLICE.titre).fontSize(18);
  const hauteurTitre = page.heightOfString(contenu.evenement, {
    width: LARGEUR_UTILE - 39,
  });
  const hauteurCarte = 16.5 + 12 + hauteurTitre + 13.5 + 30 + 16.5;

  page
    .roundedRect(MARGE, haut, LARGEUR_UTILE, hauteurCarte, 6)
    .lineWidth(0.75)
    .strokeColor(BORDURE)
    .stroke();
  etiquette(page, 'Événement', MARGE + 19.5, haut + 16.5, {
    couleur: charte.couleurPrimaire,
  });
  page
    .font(POLICE.titre)
    .fontSize(18)
    .fillColor(ENCRE)
    .text(contenu.evenement, MARGE + 19.5, haut + 28.5, {
      width: LARGEUR_UTILE - 39,
    });

  const yColonnes = haut + 28.5 + hauteurTitre + 13.5;
  const colonnes: [string, string, string][] = [
    ['Date', dateLisible(contenu.dateEvenement), POLICE.texteMoyen],
    ['Lieu', contenu.lieu, POLICE.texteMoyen],
    ['Référence du billet', contenu.codeBillet, POLICE.code],
  ];
  colonnes.forEach(([cle, valeur, police], index) => {
    const x = MARGE + 19.5 + index * (largeurColonne + 15);
    etiquette(page, cle, x, yColonnes, { largeur: largeurColonne });
    page
      .font(police)
      .fontSize(9.75)
      .fillColor(ENCRE)
      .text(valeur, x, yColonnes + 12, {
        width: largeurColonne,
        characterSpacing: police === POLICE.code ? 0.4 : 0,
      });
  });
  page.y = haut + hauteurCarte;

  const detail = [{ libelle: 'Prix du billet', valeur: montant(contenu.prix) }];
  // Nulles sur une inscription antérieure à la répercussion des frais : le
  // prix est alors directement le montant réglé.
  if (contenu.fraisFapshi !== null) {
    detail.push({
      libelle: 'Frais Fapshi',
      valeur: montant(contenu.fraisFapshi),
    });
  }
  if (contenu.fraisRetrait !== null) {
    detail.push({
      libelle: 'Frais de retrait',
      valeur: montant(contenu.fraisRetrait),
    });
  }
  const bloc = totaux(
    page,
    charte,
    detail,
    {
      libelle: 'Montant réglé',
      valeur: montant(contenu.montantTtc ?? contenu.prix),
    },
    { avant: 22.5 },
  );

  tampon(page, charte, contenu.emisLe, MARGE + 18, bloc.haut + 12);

  mention(
    page,
    'Cette facture atteste du règlement. Elle ne tient pas lieu de billet : ' +
      'l’entrée se fait avec la référence ci-dessus. Délivrée par le Comité ' +
      'd’Organisation de la Cérémonie de Fin d’Étude, elle ne vaut pas ' +
      'facture fiscale.',
    48,
  );
}

function composerFactureCotisation(
  page: Page,
  contenu: ContenuFactureCotisation,
  numero: string,
  logo: Buffer | null,
): void {
  const charte = contenu.charte;
  enTete(
    page,
    charte,
    logo,
    'Facture',
    numero,
    `Émise le ${dateLisible(contenu.emisLe)}`,
  );

  informations(page, [
    {
      cle: 'Facturé à',
      valeur: contenu.titulaire.nom,
      detail: contenu.titulaire.email,
    },
    {
      cle: 'Règlement',
      valeur: '',
      dessiner: reglement(charte, 'COMPLETE', contenu.mode),
    },
  ]);

  page.y += 30;
  tableau(
    page,
    [
      { titre: 'Désignation', part: 0.75 },
      { titre: 'Montant', part: 0.25, aDroite: true },
    ],
    [
      [
        {
          texte: `Cotisation — ${contenu.cotisation}`,
          detail: `${contenu.echeance} · réglée le ${dateLisible(contenu.recuLe)}`,
        },
        montant(contenu.montant),
      ],
    ],
  );

  // Nul pour une preuve validée : l'argent n'a pas transité par le
  // prestataire, rien n'a été retenu en plus.
  const detail = [
    { libelle: 'Versement à la cotisation', valeur: montant(contenu.montant) },
  ];
  if (contenu.fraisPaiement !== null && contenu.fraisPaiement > 0) {
    detail.push({
      libelle: 'Frais de paiement',
      valeur: montant(contenu.fraisPaiement),
    });
  }
  const bloc = totaux(
    page,
    charte,
    detail,
    { libelle: 'Montant réglé', valeur: montant(contenu.montantTtc) },
    { avant: 22.5 },
  );

  tampon(page, charte, contenu.recuLe, MARGE + 18, bloc.haut + 12);

  mention(
    page,
    `Référence du règlement : ${contenu.reference}. Cette facture atteste du ` +
      'règlement d’une échéance de cotisation ; seul le montant du versement ' +
      'est porté à la cotisation, les frais couvrent l’opérateur de paiement. ' +
      'Délivrée par le Comité d’Organisation de la Cérémonie de Fin d’Étude, ' +
      'elle ne vaut pas facture fiscale.',
    48,
  );
}

/** Tampon « RÉGLÉ », légèrement incliné, daté du jour de l'émission. */
function tampon(
  page: Page,
  charte: CharteFigee,
  emisLe: string,
  x: number,
  y: number,
): void {
  const date = new Date(emisLe)
    .toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Africa/Douala',
    })
    .toUpperCase();
  const largeur = 96;

  page.save();
  page.opacity(0.8);
  page.rotate(-6, { origin: [x + largeur / 2, y + 20] });
  page
    .roundedRect(x, y, largeur, 40, 4.5)
    .lineWidth(1.5)
    .strokeColor(charte.couleurPrimaire)
    .stroke();
  page
    .font(POLICE.texteGras)
    .fontSize(12)
    .fillColor(charte.couleurPrimaire)
    .text('RÉGLÉ', x, y + 8, {
      width: largeur,
      align: 'center',
      characterSpacing: 3,
      lineBreak: false,
    })
    .font(POLICE.texte)
    .fontSize(7)
    .text(date, x, y + 25, {
      width: largeur,
      align: 'center',
      characterSpacing: 0.75,
      lineBreak: false,
    });
  page.restore();
}

function composerRapport(
  page: Page,
  contenu: ContenuRapport,
  numero: string,
  logo: Buffer | null,
): void {
  const charte = contenu.charte;
  enTete(page, charte, logo, 'Rapport de trésorerie', numero, null);

  const fin = contenu.jusqua ?? contenu.emisLe;
  informations(
    page,
    [
      {
        cle: 'Période',
        valeur: contenu.depuis
          ? periodeLisible(contenu.depuis, fin)
          : `Jusqu’au ${dateLisible(fin)}`,
      },
      { cle: 'Établi par', valeur: contenu.emisPar },
      { cle: 'Établi le', valeur: dateLisible(contenu.emisLe) },
    ],
    { tailleValeur: 9.75 },
  );

  // Les rapports émis avant la prise en compte des frais n'en portent pas :
  // ils se redessinent tels qu'ils ont été émis, sans net inventé après coup.
  const avecFrais = contenu.recettesNettes !== undefined;
  const encaisse = avecFrais
    ? contenu.recettesNettes!
    : contenu.recettesTotales;

  page.y += 19.5;
  tuiles(page, charte, [
    {
      cle: avecFrais ? 'Encaissé net' : 'Recettes encaissées',
      valeur: montant(encaisse, false),
      unite: 'FCFA',
      enAvant: true,
    },
    {
      cle: 'Paiements aboutis',
      valeur: String(contenu.transactionsAbouties),
      unite: 'transactions',
    },
    {
      cle: 'Panier moyen',
      valeur: montant(contenu.panierMoyen, false),
      unite: 'FCFA',
    },
    {
      cle: 'Non aboutis',
      valeur: String(
        contenu.transactionsEnAttente + contenu.transactionsEchouees,
      ),
      unite: `${contenu.transactionsEnAttente} en attente · ${contenu.transactionsEchouees} échoués`,
    },
  ]);

  if (avecFrais) {
    page
      .font(POLICE.texte)
      .fontSize(8.25)
      .fillColor(ENCRE_DOUCE)
      .text(
        `Montants débités aux payeurs : ${montant(contenu.recettesTotales)} · ` +
          `frais retenus par le prestataire : ${montant(contenu.fraisPrestataire ?? 0)}.`,
        MARGE,
        page.y + 9,
        { width: LARGEUR_UTILE },
      );
  }

  section(page, 'Par origine', 22.5);
  ventilation(page, charte, 'Origine', contenu.parOrigine, avecFrais);

  section(page, 'Par moyen de paiement', 19.5);
  ventilation(page, charte, 'Moyen', contenu.parMethode, avecFrais);

  // Total général.
  reserver(page, 30);
  const y = page.y + 9;
  const colonnes = colonnesVentilation('', avecFrais);
  const xNombre = MARGE + colonnes[0].part * LARGEUR_UTILE;
  page
    .font(POLICE.texteGras)
    .fontSize(9.4)
    .fillColor(ENCRE)
    .text(avecFrais ? 'Total encaissé net' : 'Total encaissé', MARGE, y + 3, {
      lineBreak: false,
    })
    .text(String(contenu.transactionsAbouties), xNombre, y + 3, {
      width: colonnes[1].part * LARGEUR_UTILE - 9,
      align: 'right',
      lineBreak: false,
    });
  page
    .font(POLICE.titre)
    .fontSize(12.75)
    .fillColor(charte.couleurPrimaire)
    .text(montant(encaisse), MARGE, y, {
      width: LARGEUR_UTILE,
      align: 'right',
      lineBreak: false,
    });
  page.y = y + 18;

  mention(
    page,
    'Seuls les paiements aboutis sont comptés : additionner ceux en attente ' +
      'afficherait une recette qui n’existe pas encore.',
    16.5,
  );

  // Visas.
  reserver(page, 75);
  const haut = page.y + 22.5;
  const largeur = (LARGEUR_UTILE - 30) / 2;
  (
    [
      ['Établi par', contenu.emisPar],
      ['Vu par', 'Nom et fonction'],
    ] as const
  ).forEach(([cle, nom], index) => {
    const x = MARGE + index * (largeur + 30);
    etiquette(page, cle, x, haut, { largeur });
    page
      .moveTo(x, haut + 35)
      .lineTo(x + largeur, haut + 35)
      .lineWidth(0.75)
      .strokeColor('#A8A29E')
      .stroke();
    page
      .font(POLICE.texte)
      .fontSize(8.25)
      .fillColor(ENCRE_DOUCE)
      .text(nom, x, haut + 40, { width: largeur });
  });
  page.y = haut + 55;
}

/** Tuiles d'indicateurs, la première mise en avant. */
function tuiles(
  page: Page,
  charte: CharteFigee,
  indicateurs: {
    cle: string;
    valeur: string;
    unite: string;
    enAvant?: boolean;
  }[],
): void {
  const ecart = 9;
  const largeur =
    (LARGEUR_UTILE - ecart * (indicateurs.length - 1)) / indicateurs.length;
  const haut = page.y;
  const hauteur = 60;

  indicateurs.forEach((indicateur, index) => {
    const x = MARGE + index * (largeur + ecart);
    page
      .roundedRect(x, haut, largeur, hauteur, 6)
      .lineWidth(indicateur.enAvant ? 1.1 : 0.75)
      .strokeColor(indicateur.enAvant ? charte.couleurPrimaire : BORDURE)
      .stroke();
    page
      .font(POLICE.texteGras)
      .fontSize(6.5)
      .fillColor('#6B6560')
      // Sans largeur : PDFKit couperait sinon le libellé en deux lignes, la
      // seconde venant mordre sur le montant.
      .text(indicateur.cle.toUpperCase(), x + 12, haut + 10.5, {
        characterSpacing: 0.7,
        lineBreak: false,
      });
    page
      .font(POLICE.titre)
      .fontSize(16.5)
      .fillColor(indicateur.enAvant ? charte.couleurPrimaire : ENCRE)
      .text(indicateur.valeur, x + 12, haut + 22.5, {
        width: largeur - 24,
        lineBreak: false,
      });
    page
      .font(POLICE.texte)
      .fontSize(7.9)
      .fillColor(ENCRE_DOUCE)
      .text(indicateur.unite, x + 12, haut + 43, {
        width: largeur - 24,
        lineBreak: false,
        ellipsis: true,
      });
  });

  page.y = haut + hauteur;
}

/** En-têtes d'une ventilation : la colonne « Net » n'existe qu'avec les frais. */
function colonnesVentilation(
  premier: string,
  avecFrais: boolean,
): ColonneTableau[] {
  return avecFrais
    ? [
        { titre: premier, part: 0.3 },
        { titre: 'Nombre', part: 0.1, aDroite: true },
        { titre: 'Part', part: 0.24 },
        { titre: 'Débité', part: 0.18, aDroite: true },
        { titre: 'Net', part: 0.18, aDroite: true },
      ]
    : [
        { titre: premier, part: 0.38 },
        { titre: 'Nombre', part: 0.12, aDroite: true },
        { titre: 'Part', part: 0.28 },
        { titre: 'Montant', part: 0.22, aDroite: true },
      ];
}

function ventilation(
  page: Page,
  charte: CharteFigee,
  premier: string,
  lignes: LigneVentilation[],
  avecFrais: boolean,
): void {
  const somme = lignes.reduce((total, ligne) => total + ligne.montant, 0);

  tableau(
    page,
    colonnesVentilation(premier, avecFrais),
    lignes.map((ligne): Cellule[] => {
      const part = somme > 0 ? ligne.montant / somme : 0;
      const cellules: Cellule[] = [
        libelle(ligne.libelle),
        String(ligne.nombre),
        {
          texte: '',
          dessiner: (p, x, y) => barre(p, charte, x, y, part),
        },
        montant(ligne.montant),
      ];
      return avecFrais
        ? [...cellules, montant(ligne.montantNet ?? ligne.montant)]
        : cellules;
    }),
    { taille: 9.4, interligne: 7.5 },
  );
}

/** Barre de part, suivie de son pourcentage. */
function barre(
  page: Page,
  charte: CharteFigee,
  x: number,
  y: number,
  part: number,
): void {
  const longueur = 82;
  const haut = y + 3;
  page.roundedRect(x, haut, longueur, 4.5, 2.25).fill(FILET);
  if (part > 0) {
    page
      .roundedRect(x, haut, Math.max(4.5, longueur * part), 4.5, 2.25)
      .fill(charte.couleurPrimaire);
  }
  page
    .font(POLICE.texte)
    .fontSize(8.25)
    .fillColor(ENCRE_DOUCE)
    .text(`${Math.round(part * 100)} %`, x + longueur + 6, y, {
      lineBreak: false,
    });
}
