import {
  ContenuDocument,
  ContenuFacture,
  ContenuRapport,
  ContenuRecu,
} from '../entities/contenu-document';
import {
  dateLisible,
  enTete,
  ligneCle,
  LARGEUR_UTILE,
  MARGE,
  montant,
  ouvrir,
  Page,
  pied,
  section,
  tableau,
  total,
} from './mise-en-page';

/**
 * Compose le PDF d'un document à partir de son contenu figé.
 *
 * Aucune lecture du domaine ici : tout vient de `contenu`. C'est ce qui rend
 * la régénération fidèle des mois après l'émission, quand le produit a été
 * renommé et le mandat remplacé.
 *
 * `logo` arrive à part — les octets ne se rangent pas dans un `jsonb`. Nul,
 * le document se compose sans image.
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
    case 'RAPPORT_TRESORERIE':
      composerRapport(page, contenu, numero, logo);
      break;
  }

  pied(
    page,
    `${contenu.charte.nom} - piece emise le ${dateLisible(contenu.emisLe)}`,
  );
  page.end();

  return termine;
}

function composerFacture(
  page: Page,
  contenu: ContenuFacture,
  numero: string,
  logo: Buffer | null,
): void {
  enTete(page, contenu.charte, logo, 'Facture', numero);

  section(page, 'Facturé à');
  ligneCle(page, 'Nom', contenu.titulaire.nom);
  ligneCle(page, 'Adresse', contenu.titulaire.email);
  ligneCle(page, 'Date', dateLisible(contenu.emisLe));

  section(page, 'Détail');
  tableau(
    page,
    [
      { titre: 'Désignation', part: 0.52 },
      { titre: 'Qté', part: 0.12, aDroite: true },
      { titre: 'Prix unitaire', part: 0.18, aDroite: true },
      { titre: 'Montant', part: 0.18, aDroite: true },
    ],
    contenu.lignes.map((ligne) => [
      ligne.designation,
      String(ligne.quantite),
      montant(ligne.prixUnitaire),
      montant(ligne.prixUnitaire * ligne.quantite),
    ]),
  );

  total(page, 'Total', montant(contenu.total));

  section(page, 'Règlement');
  ligneCle(page, 'Statut', contenu.statutPaiement);
  ligneCle(page, 'Méthode', contenu.methodePaiement ?? 'Non renseignée');

  mention(
    page,
    'Retrait sur le campus. Cette facture est délivrée par le Bureau des ' +
      'Finissants de l’UCAC-ICAM et ne vaut pas facture fiscale.',
  );
}

function composerRecu(
  page: Page,
  contenu: ContenuRecu,
  numero: string,
  logo: Buffer | null,
): void {
  enTete(page, contenu.charte, logo, 'Reçu', numero);

  section(page, 'Remis à');
  ligneCle(page, 'Nom', contenu.titulaire.nom);
  ligneCle(page, 'Adresse', contenu.titulaire.email);
  ligneCle(page, 'Date', dateLisible(contenu.emisLe));

  section(page, 'Événement');
  ligneCle(page, 'Intitulé', contenu.evenement);
  ligneCle(page, 'Date', dateLisible(contenu.dateEvenement));
  ligneCle(page, 'Lieu', contenu.lieu);
  ligneCle(page, 'Référence du billet', contenu.codeBillet);

  section(page, 'Règlement');
  ligneCle(page, 'Méthode', contenu.methodePaiement ?? 'Non renseignée');
  total(page, 'Montant réglé', montant(contenu.prix));

  mention(
    page,
    'Ce reçu atteste du règlement. Il ne tient pas lieu de billet : ' +
      'l’entrée se fait avec la référence ci-dessus.',
  );
}

function composerRapport(
  page: Page,
  contenu: ContenuRapport,
  numero: string,
  logo: Buffer | null,
): void {
  enTete(page, contenu.charte, logo, 'Rapport de trésorerie', numero);

  section(page, 'Période');
  ligneCle(
    page,
    'Du',
    contenu.depuis ? dateLisible(contenu.depuis) : 'Origine des comptes',
  );
  ligneCle(
    page,
    'Au',
    contenu.jusqua ? dateLisible(contenu.jusqua) : dateLisible(contenu.emisLe),
  );
  ligneCle(page, 'Établi par', contenu.emisPar);
  ligneCle(page, 'Établi le', dateLisible(contenu.emisLe));

  section(page, 'Synthèse');
  ligneCle(page, 'Recettes encaissées', montant(contenu.recettesTotales));
  ligneCle(page, 'Paiements aboutis', String(contenu.transactionsAbouties));
  ligneCle(page, 'Paiements en attente', String(contenu.transactionsEnAttente));
  ligneCle(page, 'Paiements échoués', String(contenu.transactionsEchouees));
  ligneCle(page, 'Panier moyen', montant(contenu.panierMoyen));

  section(page, 'Par origine');
  tableau(
    page,
    [
      { titre: 'Origine', part: 0.5 },
      { titre: 'Nombre', part: 0.2, aDroite: true },
      { titre: 'Montant', part: 0.3, aDroite: true },
    ],
    contenu.parOrigine.map((ligne) => [
      ligne.libelle,
      String(ligne.nombre),
      montant(ligne.montant),
    ]),
  );

  section(page, 'Par méthode de paiement');
  tableau(
    page,
    [
      { titre: 'Méthode', part: 0.5 },
      { titre: 'Nombre', part: 0.2, aDroite: true },
      { titre: 'Montant', part: 0.3, aDroite: true },
    ],
    contenu.parMethode.map((ligne) => [
      ligne.libelle,
      String(ligne.nombre),
      montant(ligne.montant),
    ]),
  );

  total(page, 'Total encaissé', montant(contenu.recettesTotales));

  mention(
    page,
    'Seuls les paiements aboutis sont comptés : additionner ceux en attente ' +
      'afficherait une recette qui n’existe pas encore.',
  );
}

/** Note de bas de document, en petit et en gris. */
function mention(page: Page, texte: string): void {
  page
    .moveDown(2)
    .fillColor('#6B7280')
    .fontSize(8)
    .text(texte, MARGE, page.y, { width: LARGEUR_UTILE })
    .fillColor('#1F2937')
    .fontSize(10);
}
