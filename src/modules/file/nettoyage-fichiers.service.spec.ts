import { Stockage } from './ports/stockage';
import { NettoyageFichiers } from './nettoyage-fichiers.service';

describe('NettoyageFichiers', () => {
  let nettoyage: NettoyageFichiers;
  let supprimer: jest.Mock;

  beforeEach(() => {
    supprimer = jest.fn().mockResolvedValue(undefined);
    nettoyage = new NettoyageFichiers({ supprimer } as unknown as Stockage);
  });

  describe('remplacer', () => {
    it('efface l’ancienne clé quand une nouvelle arrive', async () => {
      await nettoyage.remplacer('avatars/avant.png', 'avatars/apres.png');

      expect(supprimer).toHaveBeenCalledWith('avatars/avant.png');
    });

    it('efface l’ancienne quand le champ est mis à null', async () => {
      // `null` veut dire « retire le fichier » : l'objet doit partir.
      await nettoyage.remplacer('avatars/avant.png', null);

      expect(supprimer).toHaveBeenCalledWith('avatars/avant.png');
    });

    it('ne touche à rien quand le champ est absent de la demande', async () => {
      // `undefined` veut dire « champ non transmis » dans une mise à jour
      // partielle. Confondre les deux effacerait des fichiers que personne
      // n'a demandé de retirer — le cas le plus grave de ce service.
      await nettoyage.remplacer('avatars/avant.png', undefined);

      expect(supprimer).not.toHaveBeenCalled();
    });

    it('ne fait rien quand la clé est inchangée', async () => {
      await nettoyage.remplacer('avatars/x.png', 'avatars/x.png');

      expect(supprimer).not.toHaveBeenCalled();
    });

    it('ne fait rien quand il n’y avait pas de fichier', async () => {
      await nettoyage.remplacer(null, 'avatars/apres.png');

      expect(supprimer).not.toHaveBeenCalled();
    });
  });

  describe('remplacerLot', () => {
    it('n’efface que les images retirées du lot', async () => {
      await nettoyage.remplacerLot(
        ['produits/a.png', 'produits/b.png', 'produits/c.png'],
        ['produits/a.png', 'produits/c.png'],
      );

      expect(supprimer).toHaveBeenCalledTimes(1);
      expect(supprimer).toHaveBeenCalledWith('produits/b.png');
    });

    it('efface tout le lot quand il est vidé', async () => {
      await nettoyage.remplacerLot(['produits/a.png', 'produits/b.png'], []);

      expect(supprimer).toHaveBeenCalledTimes(2);
    });

    it('ne touche à rien quand le lot est absent de la demande', async () => {
      await nettoyage.remplacerLot(['produits/a.png'], undefined);

      expect(supprimer).not.toHaveBeenCalled();
    });

    it('n’efface rien quand le lot n’a pas changé', async () => {
      await nettoyage.remplacerLot(['produits/a.png'], ['produits/a.png']);

      expect(supprimer).not.toHaveBeenCalled();
    });

    it('supporte un lot de départ vide', async () => {
      await nettoyage.remplacerLot(null, ['produits/a.png']);

      expect(supprimer).not.toHaveBeenCalled();
    });
  });

  describe('retirer', () => {
    it('efface plusieurs clés d’un coup', async () => {
      await nettoyage.retirer('a/1.png', 'b/2.png');

      expect(supprimer).toHaveBeenCalledTimes(2);
    });

    it('ignore les valeurs vides', async () => {
      // Les appelants passent souvent un champ nullable sans le tester.
      await nettoyage.retirer(null, undefined, '');

      expect(supprimer).not.toHaveBeenCalled();
    });

    it('ne lève jamais, même si le stockage refuse', async () => {
      // Un échec d'effacement ne doit pas refuser à l'utilisateur la
      // modification qu'il a demandée : la base est déjà à jour, et lui rendre
      // une erreur laisserait croire que rien n'a été enregistré.
      supprimer.mockRejectedValue(new Error('objet absent'));

      await expect(nettoyage.retirer('a/1.png')).resolves.toBeUndefined();
    });

    it('poursuit après un échec plutôt que d’abandonner le reste', async () => {
      supprimer
        .mockRejectedValueOnce(new Error('objet absent'))
        .mockResolvedValue(undefined);

      await nettoyage.retirer('a/1.png', 'b/2.png');

      expect(supprimer).toHaveBeenCalledTimes(2);
    });
  });
});
