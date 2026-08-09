import { PNG } from 'pngjs';
import {
  CharteFigee,
  ContenuFacture,
  ContenuRapport,
  ContenuRecu,
} from '../entities/contenu-document';
import { composer } from './rendu';

const charte: CharteFigee = {
  nom: 'Promotion ATLAS',
  annee: 2027,
  couleurPrimaire: '#123456',
  couleurSecondaire: '#ABCDEF',
  contrastePrimaire: '#FFFFFF',
  logo: 'generations/atlas.png',
};

const facture: ContenuFacture = {
  genre: 'FACTURE_COMMANDE',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  titulaire: { nom: 'Awa Ndiaye', email: 'awa@exemple.test' },
  lignes: [
    {
      designation: 'Sweat capuche · M · Noir',
      quantite: 2,
      prixUnitaire: 15000,
    },
    { designation: 'Mug émaillé', quantite: 1, prixUnitaire: 3500 },
  ],
  total: 33500,
  statutPaiement: 'COMPLETE',
  methodePaiement: 'MOBILE_MONEY',
};

const recu: ContenuRecu = {
  genre: 'RECU_BILLETTERIE',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  titulaire: { nom: 'Awa Ndiaye', email: 'awa@exemple.test' },
  evenement: 'Gala des finissants',
  dateEvenement: '2027-06-12T19:00:00.000Z',
  lieu: 'Campus UCAC-ICAM',
  codeBillet: 'BIL-4821',
  prix: 10000,
  methodePaiement: 'MOBILE_MONEY',
};

const rapport: ContenuRapport = {
  genre: 'RAPPORT_TRESORERIE',
  charte,
  emisLe: '2027-03-14T10:00:00.000Z',
  depuis: '2027-01-01T00:00:00.000Z',
  jusqua: '2027-03-31T23:59:59.000Z',
  recettesTotales: 1250000,
  transactionsAbouties: 84,
  transactionsEnAttente: 3,
  transactionsEchouees: 7,
  panierMoyen: 14881,
  parOrigine: [
    { libelle: 'BILLETTERIE', montant: 900000, nombre: 60 },
    { libelle: 'BOUTIQUE', montant: 350000, nombre: 24 },
  ],
  parMethode: [{ libelle: 'MOBILE_MONEY', montant: 1250000, nombre: 84 }],
  emisPar: 'Awa Ndiaye',
};

/** Les quatre premiers octets d'un PDF valide. */
const estUnPdf = (octets: Buffer): boolean =>
  octets.subarray(0, 4).toString() === '%PDF';

describe('Composition des PDF', () => {
  it.each([
    ['une facture', facture],
    ['un reçu', recu],
    ['un rapport', rapport],
  ])('produit %s lisible', async (_libelle, contenu) => {
    const octets = await composer(contenu, 'FAC-2027-0001', null);

    expect(estUnPdf(octets)).toBe(true);
    // Un PDF vide pèse environ 800 octets : au-dessous, rien n'a été dessiné.
    expect(octets.length).toBeGreaterThan(1500);
  });

  it('compose sans logo comme avec', async () => {
    // Le mandat peut n'en avoir désigné aucun, et le stockage peut être
    // injoignable. Ni l'un ni l'autre ne doit empêcher l'émission.
    const sans = await composer(facture, 'FAC-2027-0001', null);

    expect(estUnPdf(sans)).toBe(true);
  });

  it('compose malgré un logo illisible', async () => {
    // PDFKit ne sait poser que du PNG et du JPEG. Un SVG déposé comme logo
    // lèverait — et une facture non émise coûte plus qu'une facture sans
    // image.
    const octets = await composer(
      facture,
      'FAC-2027-0001',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );

    expect(estUnPdf(octets)).toBe(true);
  });

  it('incruste le logo du mandat quand il est lisible', async () => {
    // Contrairement à l'email, un PDF porte réellement ses images : c'est ici
    // que les octets rendus par le service d'identité visuelle servent.
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(255);

    const octets = await composer(
      facture,
      'FAC-2027-0004',
      PNG.sync.write(png),
    );

    expect(estUnPdf(octets)).toBe(true);
    // Un flux image est apparu dans le document.
    expect(octets.toString('latin1')).toContain('/Subtype /Image');
  });

  it('ne dépend d’aucune couleur particulière du mandat', async () => {
    // Le fond clair impose un texte sombre : la charte le fournit, le PDF n'a
    // pas à le recalculer.
    const octets = await composer(
      {
        ...facture,
        charte: {
          ...charte,
          couleurPrimaire: '#FFD400',
          contrastePrimaire: '#111827',
          logo: null,
        },
      },
      'FAC-2027-0002',
      null,
    );

    expect(estUnPdf(octets)).toBe(true);
  });

  it('tient plusieurs pages quand la facture est longue', async () => {
    const longue: ContenuFacture = {
      ...facture,
      lignes: Array.from({ length: 90 }, (_, index) => ({
        designation: `Article numéro ${index + 1}, avec une désignation assez longue pour occuper la colonne`,
        quantite: index + 1,
        prixUnitaire: 1500,
      })),
    };

    const octets = await composer(longue, 'FAC-2027-0003', null);

    expect(estUnPdf(octets)).toBe(true);

    // La numérotation « 1 / n » exige de connaître toutes les pages : elle est
    // posée après coup, et ce test échouerait si la mise en tampon sautait.
    const pages = /\/Count (\d+)/.exec(octets.toString('latin1'));

    expect(Number(pages?.[1])).toBeGreaterThan(1);
  });
});
