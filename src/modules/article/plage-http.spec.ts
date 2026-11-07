import { lirePlage } from './plage-http';

describe('lirePlage', () => {
  const TAILLE = 1000;

  it.each([
    ['bytes=0-99', { debut: 0, fin: 99 }],
    ['bytes=900-', { debut: 900, fin: 999 }],
    ['bytes=-100', { debut: 900, fin: 999 }],
    ['bytes=500-5000', { debut: 500, fin: 999 }],
    ['bytes=-5000', { debut: 0, fin: 999 }],
  ])('lit « %s »', (entete, attendu) => {
    expect(lirePlage(entete, TAILLE)).toEqual({ genre: 'plage', ...attendu });
  });

  it.each([undefined, '', 'bytes=', 'bytes=-', 'items=0-5', 'bytes=0-5,10-15'])(
    'sert le fichier entier pour « %s »',
    (entete) => {
      expect(lirePlage(entete, TAILLE)).toEqual({ genre: 'tout' });
    },
  );

  it.each(['bytes=1000-', 'bytes=2000-3000', 'bytes=50-10', 'bytes=-0'])(
    'refuse « %s » : hors du fichier',
    (entete) => {
      expect(lirePlage(entete, TAILLE)).toEqual({ genre: 'hors' });
    },
  );
});
