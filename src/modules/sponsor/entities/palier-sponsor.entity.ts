import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum TailleLogo {
  PETIT = 'PETIT',
  MOYEN = 'MOYEN',
  GRAND = 'GRAND',
}

/**
 * Niveau d'accréditation d'un sponsor. Les paliers sont configurables par le
 * bureau : ils déterminent l'accès à l'annuaire et les quotas associés.
 */
@Entity('paliers_sponsor')
export class PalierSponsor extends BaseEntity {
  @Column()
  @ApiProperty()
  nom: string;

  /** Ordre d'affichage et de prestige (1 = plus élevé). */
  @Column({ type: 'int', default: 0 })
  @ApiProperty()
  ordre: number;

  @Column({ name: 'acces_annuaire', default: false })
  @ApiProperty()
  accesAnnuaire: boolean;

  @Column({ name: 'max_consultations_profils', type: 'int', default: 0 })
  @ApiProperty()
  maxConsultationsProfils: number;

  @Column({ name: 'max_telechargements_cv', type: 'int', default: 0 })
  @ApiProperty()
  maxTelechargementsCv: number;

  @Column({ name: 'is_featured', default: false })
  @ApiProperty()
  isFeatured: boolean;

  @Column({
    name: 'taille_logo',
    type: 'enum',
    enum: TailleLogo,
    default: TailleLogo.MOYEN,
  })
  @ApiProperty({ enum: TailleLogo })
  tailleLogo: TailleLogo;

  @Column({ name: 'stats_detaillees', default: false })
  @ApiProperty()
  statsDetaillees: boolean;
}
