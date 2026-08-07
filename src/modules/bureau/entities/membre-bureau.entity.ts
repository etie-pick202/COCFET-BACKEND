import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Generation } from '../../generation/entities/generation.entity';
import { User } from '../../user/entities/user.entity';
import { PosteBureau } from './poste-bureau.entity';

/**
 * Titulaire d'un poste pour un mandat donné.
 *
 * L'unicité porte sur le couple (génération, poste) : deux présidents pour un
 * même mandat n'auraient pas de sens, et la passation d'administration ne
 * saurait plus qui promouvoir.
 *
 * La même personne peut en revanche cumuler deux postes, et un poste peut
 * changer de titulaire d'un mandat à l'autre — c'est même le cas général.
 */
@Entity('membres_bureau')
@Unique('uq_membre_generation_poste', ['generation', 'poste'])
export class MembreBureau extends BaseEntity {
  @ManyToOne(() => Generation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generation_id' })
  @ApiProperty({ required: false })
  generation: Generation;

  @ManyToOne(() => PosteBureau, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'poste_id' })
  @ApiProperty({ required: false })
  poste: PosteBureau;

  /**
   * Suppression du compte interdite tant qu'il siège : effacer le titulaire
   * laisserait un poste pourvu par personne, et l'histoire du mandat
   * incomplète.
   */
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ required: false })
  user: User;

  /** Mot de la personne sur son rôle, affiché sur la page du bureau. */
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  presentation: string | null;
}
