import {
  ContenuFacture,
  ContenuFactureCotisation,
  ContenuRapport,
  ContenuRecu,
} from './entities/contenu-document';
import {
  enteteTelechargement,
  nettoyerNom,
  nomFichierDocument,
} from './nom-fichier';

const charte = {
  nom: 'Promotion ATLAS',
  annee: 2027,
  couleurPrimaire: '#123456',
  couleurSecondaire: '#ABCDEF',
  contrastePrimaire: '#FFFFFF',
  logo: null,
};
const titulaire = { nom: 'Awa Ndiaye', email: 'awa@exemple.test' };

const recu = (evenement: string): ContenuRecu => ({
  genre: 'RECU_BILLETTERIE',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  titulaire,
  evenement,
  dateEvenement: '2027-06-12T19:00:00.000Z',
  lieu: 'Campus',
  codeBillet: 'BIL-1',
  prix: 10_000,
  fraisFapshi: null,
  fraisRetrait: null,
  montantTtc: null,
  methodePaiement: null,
});

const commande = (designations: string[]): ContenuFacture => ({
  genre: 'FACTURE_COMMANDE',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  titulaire,
  lignes: designations.map((designation) => ({
    designation,
    quantite: 1,
    prixUnitaire: 1_000,
  })),
  total: 1_000,
  fraisFapshi: null,
  fraisRetrait: null,
  montantTtc: null,
  statutPaiement: 'COMPLETE',
  methodePaiement: null,
});

const cotisation: ContenuFactureCotisation = {
  genre: 'FACTURE_COTISATION',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  titulaire,
  cotisation: 'Cotisation des finissants 2027',
  echeance: 'Première tranche',
  montant: 5_000,
  fraisPaiement: 211,
  montantTtc: 5_211,
  mode: 'EN_LIGNE',
  reference: 'COT-1',
  recuLe: '2027-03-14T10:00:00.000Z',
};

/**
 * « Facture Awa Ndiaye de Gala des finissants » : c'est le nom que la
 * personne retrouve dans son dossier de téléchargements.
 */
describe('nomFichierDocument', () => {
  it('nomme la facture d’un billet : propriétaire, puis événement', () => {
    expect(nomFichierDocument(recu('Gala des finissants'), 'FAC-1')).toBe(
      'Facture Awa Ndiaye de Gala des finissants',
    );
  });

  it('nomme la facture d’une commande d’après son premier article', () => {
    expect(
      nomFichierDocument(commande(['Sweat capuche · M · Noir']), 'FAC-1'),
    ).toBe('Facture Awa Ndiaye de Sweat capuche');
  });

  it('dit combien d’autres articles accompagnent le premier', () => {
    expect(
      nomFichierDocument(
        commande(['Sweat capuche · M', 'Mug émaillé', 'Casquette']),
        'FAC-1',
      ),
    ).toBe('Facture Awa Ndiaye de Sweat capuche et 2 autres articles');
    expect(nomFichierDocument(commande(['Sweat', 'Mug']), 'FAC-1')).toBe(
      'Facture Awa Ndiaye de Sweat et 1 autre article',
    );
  });

  it('distingue les règlements d’une même cotisation par leur échéance', () => {
    expect(nomFichierDocument(cotisation, 'FAC-1')).toBe(
      'Facture Awa Ndiaye de Cotisation des finissants 2027 - Première tranche',
    );
  });

  it('nomme un rapport d’après sa période', () => {
    const rapport = {
      genre: 'RAPPORT_TRESORERIE',
      depuis: '2027-01-01T00:00:00.000Z',
      jusqua: '2027-03-31T00:00:00.000Z',
    } as ContenuRapport;

    expect(nomFichierDocument(rapport, 'RAP-1')).toBe(
      'Rapport de trésorerie du 2027-01-01 au 2027-03-31',
    );
    expect(
      nomFichierDocument({ ...rapport, depuis: null, jusqua: null }, 'RAP-1'),
    ).toBe('Rapport de trésorerie complet');
  });

  it('ôte ce qu’un nom de fichier ne supporte pas', () => {
    expect(
      nomFichierDocument(recu('Soirée "Retro" : 80/90 <live>'), 'FAC-1'),
    ).toBe('Facture Awa Ndiaye de Soirée Retro 80 90 live');
  });

  it('borne la longueur du nom', () => {
    const nom = nomFichierDocument(recu('x'.repeat(400)), 'FAC-1');

    expect(nom.length).toBeLessThanOrEqual(150);
  });
});

describe('nettoyerNom', () => {
  it('resserre les espaces et retire les caractères de contrôle', () => {
    expect(nettoyerNom('  a\u0000b\n\n  c  ')).toBe('a b c');
  });
});

describe('enteteTelechargement', () => {
  it('porte le vrai nom, accents compris, et un repli en ASCII', () => {
    const entete = enteteTelechargement('Facture Zoé Ngô de Fête');

    expect(entete).toContain('attachment');
    expect(entete).toContain('filename="Facture Zoe Ngo de Fete.pdf"');
    expect(entete).toContain(
      "filename*=UTF-8''Facture%20Zo%C3%A9%20Ng%C3%B4%20de%20F%C3%AAte.pdf",
    );
  });

  it('ne laisse aucun guillemet casser l’en-tête', () => {
    expect(enteteTelechargement('a"b')).toContain('filename="ab.pdf"');
  });

  it('encode les apostrophes et parenthèses, que RFC 5987 refuse tels quels', () => {
    const entete = enteteTelechargement("L'été (2027)");

    expect(entete).toContain('%27');
    expect(entete).toContain('%28');
    expect(entete).toContain('%29');
  });
});
