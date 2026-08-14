import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';

/**
 * Usages autorisés, et contraintes propres à chacun.
 *
 * Le préfixe n'est pas libre : laisser l'appelant choisir où atterrit son
 * fichier permettrait de déposer un CV dans le dossier public des logos, ou
 * d'écraser l'arborescence attendue par les autres modules.
 */
export const USAGES = {
  /** Sa propre photo : tout compte authentifie y a droit. */
  avatar: {
    prefixe: 'avatars',
    tailleMax: 2 * 1024 * 1024,
    types: ['image'],
    roles: null,
    mimesAutorises: null,
  },
  evenement: {
    prefixe: 'evenements',
    tailleMax: 5 * 1024 * 1024,
    types: ['image'],
    roles: [Role.ADMIN],
    mimesAutorises: null,
  },
  produit: {
    prefixe: 'produits',
    tailleMax: 5 * 1024 * 1024,
    types: ['image'],
    roles: [Role.ADMIN],
    mimesAutorises: null,
  },
  /** Le partenaire depose son logo ; le bureau peut le faire pour lui. */
  sponsor: {
    prefixe: 'sponsors',
    tailleMax: 2 * 1024 * 1024,
    types: ['image'],
    roles: [Role.SPONSOR, Role.ADMIN],
    mimesAutorises: null,
  },
  article: {
    prefixe: 'articles',
    tailleMax: 5 * 1024 * 1024,
    types: ['image'],
    roles: [Role.ADMIN],
    mimesAutorises: null,
  },
  /**
   * Logo du mandat, celui qui habille la plateforme.
   *
   * **PNG ou JPEG seulement**, alors que les autres visuels acceptent aussi
   * GIF et WebP. Ce logo n'est pas qu'affiche : il est incruste dans les
   * factures et les recus, et PDFKit ne sait poser que ces deux formats. Un
   * WebP accepte ici produirait des documents sans logo — degrades en
   * silence, jamais en echec, donc decouverts par le destinataire. Autant
   * refuser au depot, ou le bureau peut encore convertir son fichier.
   */
  logo: {
    prefixe: 'logos',
    tailleMax: 2 * 1024 * 1024,
    types: ['image'],
    roles: [Role.ADMIN],
    mimesAutorises: ['image/png', 'image/jpeg'],
  },
  /**
   * Preuve d'un paiement remis hors de la plateforme.
   *
   * Ouvert a tout compte authentifie : c'est le payeur qui depose sa capture,
   * et il n'est ni du bureau ni forcement etudiant. La piece ne prouve rien
   * par elle-meme — une capture se fabrique en deux minutes — et ne vaut que
   * par la validation de quelqu'un qui accede aux finances.
   */
  justificatif: {
    prefixe: 'justificatifs',
    tailleMax: 5 * 1024 * 1024,
    types: ['image'],
    roles: null,
    mimesAutorises: null,
  },

  /**
   * Reserve aux etudiants.
   *
   * L'annuaire des finissants est ce que consultent les entreprises
   * partenaires : un CV depose par un visiteur externe n'y a pas sa place, et
   * ouvrirait un espace de stockage a qui n'est pas concerne par le dispositif.
   */
  cv: {
    prefixe: 'cv',
    tailleMax: 5 * 1024 * 1024,
    types: ['pdf'],
    roles: [Role.STUDENT, Role.ADMIN],
    mimesAutorises: null,
  },
} as const;

export type Usage = keyof typeof USAGES;

/**
 * Signatures de début de fichier.
 *
 * C'est le cœur du contrôle : `file.mimetype` est **fourni par le client**,
 * qui annonce ce qu'il veut. Un exécutable renommé en `.png` et déclaré
 * `image/png` passerait toute vérification fondée sur ce seul champ. Les
 * premiers octets, eux, ne se renomment pas.
 */
const SIGNATURES: Record<string, { octets: number[]; mime: string }[]> = {
  image: [
    { octets: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
    { octets: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
    { octets: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
    // WebP : « RIFF » puis, à l'octet 8, « WEBP ». Le second contrôle est
    // nécessaire, RIFF servant aussi aux fichiers audio et vidéo.
    { octets: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
  ],
  pdf: [{ octets: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' }],
};

export interface FichierValide {
  prefixe: string;
  /** Type réellement détecté, à stocker de préférence à celui annoncé. */
  mimeReel: string;
}

/**
 * Valide un envoi et renvoie le préfixe de destination.
 *
 * Lève une `BadRequestException` explicite plutôt qu'un refus muet : la
 * personne doit comprendre si c'est la taille, le format ou l'usage qui
 * bloque.
 */
export function validerFichier(
  usage: Usage,
  fichier: { originalname: string; mimetype: string; buffer: Buffer },
  role: Role,
): FichierValide {
  const regles = USAGES[usage];
  if (!regles) {
    throw new BadRequestException(
      `Usage inconnu. Valeurs acceptées : ${Object.keys(USAGES).join(', ')}.`,
    );
  }

  const autorises = regles.roles as readonly Role[] | null;
  if (autorises && !autorises.includes(role)) {
    // 403 et non 400 : la demande est bien formée, c'est le droit qui manque.
    throw new ForbiddenException(
      `Votre compte ne peut pas envoyer de fichier de type « ${usage} ».`,
    );
  }

  if (!fichier.buffer?.length) {
    throw new BadRequestException('Le fichier est vide.');
  }

  if (fichier.buffer.length > regles.tailleMax) {
    const maxMo = Math.round(regles.tailleMax / (1024 * 1024));
    throw new BadRequestException(
      `Le fichier dépasse la taille autorisée pour un ${usage} (${maxMo} Mo).`,
    );
  }

  const mimeReel = detecterType(fichier.buffer, regles.types);
  if (!mimeReel) {
    throw new BadRequestException(
      `Le contenu du fichier ne correspond pas au format attendu (${regles.types.join(', ')}).`,
    );
  }

  // Restriction plus fine que la famille, quand l'usage l'exige : un logo doit
  // pouvoir s'incruster dans un PDF, ce dont tous les formats d'image ne sont
  // pas capables.
  const mimes = regles.mimesAutorises as readonly string[] | null;
  if (mimes && !mimes.includes(mimeReel)) {
    throw new BadRequestException(
      `Un fichier de type « ${usage} » doit être au format ${mimes.join(' ou ')} — reçu ${mimeReel}.`,
    );
  }

  return { prefixe: regles.prefixe, mimeReel };
}

function detecterType(
  contenu: Buffer,
  familles: readonly string[],
): string | null {
  for (const famille of familles) {
    for (const { octets, mime } of SIGNATURES[famille] ?? []) {
      if (!octets.every((o, i) => contenu[i] === o)) {
        continue;
      }
      // RIFF seul ne suffit pas : il couvre aussi WAV et AVI.
      if (
        mime === 'image/webp' &&
        contenu.subarray(8, 12).toString() !== 'WEBP'
      ) {
        continue;
      }
      return mime;
    }
  }

  return null;
}
