import { ApiProperty } from '@nestjs/swagger';

/**
 * Emails qu'aucun réglage ne peut couper, et la raison de chacun.
 *
 * Le principe du choix laissé à chacun s'arrête là où le couper enfermerait la
 * personne dehors, ou lui ferait perdre ce qu'elle a payé. Deux catégories :
 *
 * **La sécurité du compte.** Qui désactiverait la réinitialisation de mot de
 * passe et l'oublierait n'aurait plus aucun recours. Qui couperait l'alerte de
 * changement d'adresse ne saurait rien d'une prise de contrôle de son compte —
 * c'est précisément le message qui permet de réagir.
 *
 * **Les pièces.** Un billet coupé, et la personne se présente à l'entrée sans
 * QR code, pour un événement qu'elle a réglé.
 *
 * Cette liste est **exposée par l'API**, et non seulement documentée ici : une
 * interface qui afficherait un interrupteur sans effet mentirait à
 * l'utilisateur. Mieux vaut dire ce qui ne se coupe pas, et pourquoi.
 */
export class EmailObligatoire {
  @ApiProperty()
  cle: string;

  @ApiProperty()
  libelle: string;

  @ApiProperty({ description: 'Pourquoi il ne peut pas être désactivé.' })
  motif: string;
}

export const EMAILS_OBLIGATOIRES: EmailObligatoire[] = [
  {
    cle: 'verification-email',
    libelle: 'Confirmation d’adresse',
    motif:
      'Sans elle, aucun compte ne s’active : la couper reviendrait à ne jamais pouvoir se connecter.',
  },
  {
    cle: 'mot-de-passe-oublie',
    libelle: 'Réinitialisation de mot de passe',
    motif:
      'Seul recours en cas d’oubli. La désactiver, c’est risquer de perdre son compte définitivement.',
  },
  {
    cle: 'changement-email',
    libelle: 'Confirmation d’une nouvelle adresse',
    motif:
      'Le changement ne prend effet que par ce lien : sans lui, la demande resterait sans suite.',
  },
  {
    cle: 'alerte-changement-email',
    libelle: 'Alerte de changement d’adresse',
    motif:
      'C’est le filet qui permet de réagir à une prise de contrôle du compte.',
  },
  {
    cle: 'tentative-inscription',
    libelle: 'Tentative d’inscription avec votre adresse',
    motif:
      'Avertit d’une tentative faite avec votre adresse : une alerte de sécurité ne se coupe pas.',
  },
  {
    cle: 'billet',
    libelle: 'Billet et QR code',
    motif:
      'Le coupé, et l’on se présente à l’entrée sans code, pour un événement déjà réglé.',
  },
  {
    cle: 'invitation-sponsor',
    libelle: 'Invitation partenaire',
    motif:
      'C’est par ce message que l’accès partenaire se crée : sans lui, il n’existe pas.',
  },
];
