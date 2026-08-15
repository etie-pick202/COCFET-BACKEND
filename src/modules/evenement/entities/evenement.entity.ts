import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Produit } from '../../boutique/entities/produit.entity';
import { Generation } from '../../generation/entities/generation.entity';
import { Sponsor } from '../../sponsor/entities/sponsor.entity';

export enum TypeEvenement {
  GRATUIT = 'GRATUIT',
  PAYANT = 'PAYANT',
  SUR_INVITATION = 'SUR_INVITATION',
}

export enum StatutEvenement {
  BROUILLON = 'BROUILLON',
  PUBLIE = 'PUBLIE',
  ARCHIVE = 'ARCHIVE',
}

/** Ce qui est exigé à l'entrée d'un événement. */
export enum ControleAcces {
  /** Aucun filtrage : l'inscription compte les venants, elle n'ouvre rien. */
  AUCUN = 'AUCUN',
  /** Billet reçu par email, présentable hors ligne. */
  QR_FIXE = 'QR_FIXE',
  /** Code renouvelé toutes les 30 s dans l'application. */
  QR_TOURNANT = 'QR_TOURNANT',
}

@Entity('evenements')
export class Evenement extends BaseEntity {
  @Column()
  @ApiProperty()
  titre: string;

  @Column({ type: 'text' })
  @ApiProperty()
  description: string;

  @Column({ name: 'image_couverture', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  imageCouverture: string | null;

  @Column({ name: 'date_debut', type: 'timestamptz' })
  @ApiProperty({ format: 'date-time' })
  dateDebut: Date;

  @Column({ name: 'date_fin', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  dateFin: Date | null;

  @Column()
  @ApiProperty()
  lieu: string;

  @Column({ name: 'lieu_url', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  lieuUrl: string | null;

  @Column({ type: 'enum', enum: TypeEvenement, default: TypeEvenement.GRATUIT })
  @ApiProperty({ enum: TypeEvenement })
  type: TypeEvenement;

  /** Tarifs en FCFA (devise sans sous-unité, stockée en entier). */
  @Column({ name: 'prix_campus', type: 'int', default: 0 })
  @ApiProperty()
  prixCampus: number;

  @Column({ name: 'prix_externe', type: 'int', default: 0 })
  @ApiProperty()
  prixExterne: number;

  @Column({ name: 'capacite_max', type: 'int', default: 0 })
  @ApiProperty()
  capaciteMax: number;

  /** Dénormalisé pour afficher la jauge sans recompter les inscriptions. */
  @Column({ name: 'inscriptions_actuelles', type: 'int', default: 0 })
  @ApiProperty()
  inscriptionsActuelles: number;

  @Column({
    type: 'enum',
    enum: StatutEvenement,
    default: StatutEvenement.BROUILLON,
  })
  @ApiProperty({ enum: StatutEvenement })
  statut: StatutEvenement;

  /**
   * Ce qui est exigé à l'entrée.
   *
   * Trois régimes, du plus léger au plus strict — le bon dépend de l'enjeu,
   * pas du produit :
   *
   * - `AUCUN` : personne ne filtre la porte. L'inscription sert à savoir
   *   combien de monde vient, pas à contrôler qui entre. Aucun billet n'est
   *   émis : en fabriquer un ferait croire à un contrôle inexistant.
   * - `QR_FIXE` : billet reçu par email, présentable hors ligne. L'usage
   *   unique empêche deux entrées avec le même code, mais pas la mauvaise —
   *   celui qui montre l'image en premier passe, fût-il le destinataire d'une
   *   capture d'écran.
   * - `QR_TOURNANT` : le code se renouvelle toutes les trente secondes dans
   *   l'application. Ce qui se photographie est périmé avant d'arriver. Le
   *   prix est réel : il faut du réseau à l'entrée, et le billet ne s'emporte
   *   plus en image.
   */
  @Column({
    name: 'controle_acces',
    type: 'enum',
    enum: ControleAcces,
    default: ControleAcces.QR_FIXE,
  })
  @ApiProperty({
    enum: ControleAcces,
    description:
      'AUCUN : aucun billet émis. QR_FIXE : billet par email, valable hors ' +
      'ligne. QR_TOURNANT : code renouvelé toutes les 30 s dans ' +
      'l’application, ni téléchargeable ni envoyé par email.',
  })
  controleAcces: ControleAcces;

  @Column({ type: 'simple-array', nullable: true })
  @ApiProperty({ nullable: true, type: [String] })
  galerie: string[] | null;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  recap: string | null;

  @ManyToOne(() => Generation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'generation_id' })
  @ApiProperty({ nullable: true, required: false })
  generation: Generation | null;

  @ManyToMany(() => Sponsor, (sponsor) => sponsor.evenements)
  @JoinTable({
    name: 'evenement_sponsors',
    joinColumn: { name: 'evenement_id' },
    inverseJoinColumn: { name: 'sponsor_id' },
  })
  @ApiProperty({ required: false })
  sponsors: Sponsor[];

  @OneToMany(() => Produit, (produit) => produit.evenement)
  @ApiProperty({ required: false })
  produits: Produit[];

  /**
   * L'evenement accepte les preuves de paiement remises hors ligne.
   *
   * Ferme par defaut, et c'est deliberé : ouvrir partout exposerait chaque
   * inscription a une capture fabriquee, que quelqu'un finirait par valider
   * sans regarder. L'organisateur choisit evenement par evenement, selon qu'il
   * accepte ou non d'etre paye de la main a la main.
   */
  @Column({ name: 'accepte_justificatif', default: false })
  @ApiProperty({
    description:
      'Vrai : un inscrit peut deposer une capture de paiement, soumise a la ' +
      'validation de la tresorerie.',
  })
  accepteJustificatif: boolean;
}
