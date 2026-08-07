import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/**
 * Poste du bureau COCFET — président, vice-président, secrétaire, et les
 * autres.
 *
 * Le catalogue est **une donnée, pas une énumération** : le bureau doit
 * pouvoir créer ou retirer un poste sans qu'on redéploie l'application. Chaque
 * mandat s'organise à sa façon.
 */
@Entity('postes_bureau')
export class PosteBureau extends BaseEntity {
  @Index({ unique: true })
  @Column()
  @ApiProperty()
  nom: string;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  description: string | null;

  /** Ordre protocolaire d'affichage. 1 = président. */
  @Column({ type: 'int', default: 0 })
  @ApiProperty()
  ordre: number;

  /**
   * Poste sans lequel un mandat n'a pas de sens.
   *
   * Une génération dont les postes clés ne sont pas pourvus ne peut pas être
   * activée : la plateforme basculerait sur un bureau qui n'existe pas.
   */
  @Column({ name: 'est_cle', default: false })
  @ApiProperty()
  estCle: boolean;

  /**
   * Poste dont le titulaire administre la plateforme.
   *
   * C'est par lui que la passation se fait : à l'activation d'une génération,
   * les titulaires de ces postes deviennent administrateurs, et les anciens
   * — devenus alumni — cessent de l'être.
   */
  @Column({ name: 'accorde_administration', default: false })
  @ApiProperty()
  accordeAdministration: boolean;
}
