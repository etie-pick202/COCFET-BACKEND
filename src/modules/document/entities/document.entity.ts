import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import type { ContenuDocument } from './contenu-document';

export enum TypeDocument {
  /** Facture d'une commande de la boutique. */
  FACTURE_COMMANDE = 'FACTURE_COMMANDE',
  /** Reçu d'une inscription payante à un événement. */
  RECU_BILLETTERIE = 'RECU_BILLETTERIE',
  /** Rapport financier d'une période, à l'usage du bureau. */
  RAPPORT_TRESORERIE = 'RAPPORT_TRESORERIE',
}

/**
 * Une pièce justificative émise par la plateforme.
 *
 * **Le fichier PDF est jetable, la ligne ne l'est pas.** Les octets sont
 * purgés au-delà de trois mois — c'est le stockage qui coûte, et un PDF que
 * personne ne rouvre n'a pas à occuper une place indéfinie. Tout ce qui fait
 * la pièce justificative reste : le type, le numéro, le montant, la date, le
 * titulaire, et surtout `contenu`, qui permet de la redessiner à l'identique.
 *
 * Un document purgé continue donc de figurer dans « mes factures », et se
 * régénère au premier téléchargement.
 */
/**
 * Les index sont nommés ici **et** créés par migration, comme l'index partiel
 * de `Generation` : sans la déclaration, TypeORM les verrait comme des index
 * de trop et proposerait de les supprimer à la première génération de
 * migration.
 *
 * L'unicité de `(type, source)` porte l'idempotence de l'émission : redemander
 * la facture d'une commande doit rendre la même pièce, et c'est la base qui le
 * garantit — deux requêtes simultanées passeraient sinon toutes deux le
 * contrôle applicatif.
 *
 * L'index partiel sert la purge nocturne, qui ne balaie que les documents dont
 * le fichier est encore présent.
 */
@Index('UQ_documents_type_source', ['type', 'source'], { unique: true })
@Index('IDX_documents_purge', ['createdAt'], { where: '"cle" IS NOT NULL' })
@Entity('documents')
export class Document extends BaseEntity {
  @Column({ type: 'enum', enum: TypeDocument })
  @Index('IDX_documents_type')
  @ApiProperty({ enum: TypeDocument })
  type: TypeDocument;

  /**
   * Numéro lisible et unique — « FAC-2027-0042 ».
   *
   * Il figure sur le PDF et sert de référence dans un échange : « la facture
   * 42 » se retrouve, « le document 3f2a-… » ne se dicte pas au téléphone.
   */
  @Index('UQ_documents_numero', { unique: true })
  @Column()
  @ApiProperty({ example: 'FAC-2027-0042' })
  numero: string;

  /**
   * Titulaire de la pièce. Nul pour un rapport, qui n'appartient à personne :
   * il relève du bureau, et la trésorière qui l'émet n'en est pas propriétaire.
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ required: false, nullable: true })
  user: User | null;

  @Column()
  @ApiProperty({ example: 'Commande de 2 articles' })
  titre: string;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({ description: 'FCFA. Zéro pour un rapport.' })
  montant: number;

  /**
   * Source de l'émission — identifiant de la commande, de l'inscription, ou
   * bornes de la période pour un rapport.
   *
   * C'est elle qui rend l'émission idempotente : redemander la facture d'une
   * commande rend la même, jamais une seconde.
   */
  @Index('IDX_documents_source')
  @Column()
  @ApiProperty()
  source: string;

  /**
   * Tout ce qu'il faut pour redessiner le PDF, figé à l'émission.
   *
   * Rien n'est relu dans le domaine à la régénération, et c'est délibéré : un
   * produit renommé, un tarif corrigé ou un mandat suivant changeraient la
   * pièce des mois après son émission. Une facture qui ne dit plus la même
   * chose n'est plus une facture.
   */
  @Column({ type: 'jsonb' })
  contenu: ContenuDocument;

  /**
   * Clé du PDF dans le stockage. Nulle quand le fichier a été purgé — la
   * ligne, elle, demeure.
   */
  @Column({ type: 'varchar', nullable: true })
  cle: string | null;

  @Column({ name: 'purge_le', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  purgeLe: Date | null;
}
