import {
  beneficieDuTarifCampus,
  lireIdentiteCampus,
  normaliserEmail,
  TypeIdentite,
} from './identite-campus';

/**
 * Ces règles décident qui paie le tarif campus. Une erreur ici a un coût
 * financier direct et silencieux : la plateforme continuerait de fonctionner,
 * en facturant simplement les mauvaises personnes.
 */
describe('normaliserEmail', () => {
  it('met en minuscules et retire les espaces', () => {
    expect(normaliserEmail('  Etienne.Mayack@2027.UCAC-ICAM.COM ')).toBe(
      'etienne.mayack@2027.ucac-icam.com',
    );
  });

  it('retire le suffixe + de la partie locale', () => {
    // La plupart des messageries livrent ces trois adresses dans la même
    // boîte : sans normalisation, une boîte donnerait autant de comptes.
    expect(normaliserEmail('etienne.mayack+1@2027.ucac-icam.com')).toBe(
      'etienne.mayack@2027.ucac-icam.com',
    );
    expect(normaliserEmail('etienne.mayack+nimporte.quoi@icam.fr')).toBe(
      'etienne.mayack@icam.fr',
    );
  });

  it('ne touche pas au domaine si celui-ci contient un +', () => {
    expect(normaliserEmail('a@b+c.com')).toBe('a@b+c.com');
  });

  it("laisse intacte une chaîne sans arobase plutôt que d'échouer", () => {
    expect(normaliserEmail('pas-une-adresse')).toBe('pas-une-adresse');
  });
});

describe('lireIdentiteCampus', () => {
  const GENERATION_ACTIVE = 2027;

  it.each([
    ['etienne.mayack@2027.ucac-icam.com', 2027, 'ucac-icam.com'],
    ['etienne.mayack@2026.icam.fr', 2026, 'icam.fr'],
    ['a.b@2029.ucac-icam.com', 2029, 'ucac-icam.com'],
  ])(
    'reconnaît %s comme étudiant de la promotion %i',
    (email, promotion, domaine) => {
      expect(lireIdentiteCampus(email, GENERATION_ACTIVE)).toEqual({
        type: TypeIdentite.ETUDIANT,
        promotion,
        domaine,
      });
    },
  );

  it('reconnaît une adresse institutionnelle sans année comme personnel', () => {
    expect(
      lireIdentiteCampus('admin@ucac-icam.com', GENERATION_ACTIVE),
    ).toEqual({
      type: TypeIdentite.PERSONNEL,
      promotion: null,
      domaine: 'ucac-icam.com',
    });
  });

  it('traite un sous-domaine non numérique comme personnel', () => {
    // « dsi.ucac-icam.com » est un service, pas une promotion.
    expect(
      lireIdentiteCampus('contact@dsi.ucac-icam.com', GENERATION_ACTIVE).type,
    ).toBe(TypeIdentite.PERSONNEL);
  });

  it.each(['x@gmail.com', 'x@ucac-icam.fr', 'x@icam.com', 'x@faux-icam.fr'])(
    'traite %s comme externe',
    (email) => {
      expect(lireIdentiteCampus(email, GENERATION_ACTIVE)).toEqual({
        type: TypeIdentite.EXTERNE,
        promotion: null,
        domaine: null,
      });
    },
  );

  it("ne se laisse pas tromper par un domaine qui contient le nom de l'école", () => {
    // Un attaquant pourrait enregistrer ce domaine pour se faire passer pour
    // un étudiant : le suffixe doit correspondre exactement.
    expect(lireIdentiteCampus('x@2027.ucac-icam.com.attaquant.fr').type).toBe(
      TypeIdentite.EXTERNE,
    );
    expect(lireIdentiteCampus('x@notucac-icam.com').type).toBe(
      TypeIdentite.EXTERNE,
    );
  });

  it.each([1899, 2199, 1000])(
    'refuse la promotion invraisemblable %i et retombe sur personnel',
    (annee) => {
      const identite = lireIdentiteCampus(
        `x@${annee}.icam.fr`,
        GENERATION_ACTIVE,
      );
      expect(identite.type).toBe(TypeIdentite.PERSONNEL);
      expect(identite.promotion).toBeNull();
    },
  );

  it('accepte les promotions dans la fenêtre autour de la génération active', () => {
    // 2017 = 2027 - 10, borne basse ; 2033 = 2027 + 6, borne haute.
    expect(lireIdentiteCampus('x@2017.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.ETUDIANT,
    );
    expect(lireIdentiteCampus('x@2033.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.ETUDIANT,
    );
    expect(lireIdentiteCampus('x@2016.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.PERSONNEL,
    );
    expect(lireIdentiteCampus('x@2034.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.PERSONNEL,
    );
  });

  it('exige exactement quatre chiffres', () => {
    expect(lireIdentiteCampus('x@27.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.PERSONNEL,
    );
    expect(lireIdentiteCampus('x@20270.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.PERSONNEL,
    );
    expect(lireIdentiteCampus('x@2027a.icam.fr', GENERATION_ACTIVE).type).toBe(
      TypeIdentite.PERSONNEL,
    );
  });

  it('applique la normalisation avant analyse', () => {
    expect(
      lireIdentiteCampus('Etienne+test@2027.UCAC-ICAM.COM', GENERATION_ACTIVE),
    ).toEqual({
      type: TypeIdentite.ETUDIANT,
      promotion: 2027,
      domaine: 'ucac-icam.com',
    });
  });
});

describe('beneficieDuTarifCampus', () => {
  const GENERATION_ACTIVE = 2027;

  it('accorde le tarif campus à la promotion en cours', () => {
    expect(beneficieDuTarifCampus(2027, GENERATION_ACTIVE)).toBe(true);
  });

  it('accorde le tarif campus aux promotions encore scolarisées', () => {
    expect(beneficieDuTarifCampus(2028, GENERATION_ACTIVE)).toBe(true);
    expect(beneficieDuTarifCampus(2029, GENERATION_ACTIVE)).toBe(true);
  });

  it('refuse le tarif campus aux anciens diplômés', () => {
    expect(beneficieDuTarifCampus(2026, GENERATION_ACTIVE)).toBe(false);
    expect(beneficieDuTarifCampus(2020, GENERATION_ACTIVE)).toBe(false);
  });

  it('refuse le tarif campus sans promotion', () => {
    // Personnel et externes.
    expect(beneficieDuTarifCampus(null, GENERATION_ACTIVE)).toBe(false);
  });

  it('bascule automatiquement au changement de génération', () => {
    // La promotion 2027 paie le tarif campus tant que la génération est 2027,
    // et le perd dès que la génération devient 2028 : elle est sortie.
    expect(beneficieDuTarifCampus(2027, 2027)).toBe(true);
    expect(beneficieDuTarifCampus(2027, 2028)).toBe(false);
  });
});
