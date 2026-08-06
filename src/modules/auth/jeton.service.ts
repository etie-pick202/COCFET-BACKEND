import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { JetonAuth, TypeJeton } from './entities/jeton-auth.entity';

/** 32 octets aléatoires : deviner un jeton n'est pas envisageable. */
const OCTETS_JETON = 32;

/** Durées de validité, choisies selon le risque associé à chaque parcours. */
export const DUREES_VALIDITE_MS: Record<TypeJeton, number> = {
  [TypeJeton.VERIFICATION_EMAIL]: 24 * 60 * 60 * 1000,
  // Plus court : un lien de réinitialisation intercepté permet la prise de
  // contrôle immédiate du compte.
  [TypeJeton.REINITIALISATION_MOT_DE_PASSE]: 60 * 60 * 1000,
  // Plus long : l'admin et le sponsor ne sont pas synchronisés, et le contact
  // d'une entreprise peut mettre plusieurs jours à traiter son courrier.
  [TypeJeton.INVITATION_SPONSOR]: 7 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class JetonService {
  constructor(
    @InjectRepository(JetonAuth)
    private readonly jetons: Repository<JetonAuth>,
  ) {}

  /**
   * Émet un jeton et renvoie sa valeur **en clair**, seule occasion où elle
   * existe : seule l'empreinte est conservée.
   *
   * Les jetons du même type encore en attente sont invalidés, pour qu'un lien
   * demandé trois fois n'en laisse pas trois utilisables.
   */
  async emettre(user: User, type: TypeJeton): Promise<string> {
    // Requête explicite plutôt que critère d'objet : « consommeLe: undefined »
    // ne signifie pas « IS NULL » pour TypeORM, il ne correspond à rien et
    // l'update n'affecte alors aucune ligne. Et `update()` ne sait pas filtrer
    // sur une relation.
    await this.jetons
      .createQueryBuilder()
      .update(JetonAuth)
      .set({ consommeLe: new Date() })
      .where('user_id = :userId AND type = :type AND consomme_le IS NULL', {
        userId: user.id,
        type,
      })
      .execute();

    const valeur = randomBytes(OCTETS_JETON).toString('base64url');

    await this.jetons.save(
      this.jetons.create({
        user,
        type,
        empreinte: this.empreinte(valeur),
        expireLe: new Date(Date.now() + DUREES_VALIDITE_MS[type]),
        consommeLe: null,
      }),
    );

    return valeur;
  }

  /**
   * Vérifie un jeton et le consomme dans le même mouvement.
   *
   * La consommation est conditionnée à `consommeLe IS NULL` en base : deux
   * requêtes simultanées portant le même jeton ne peuvent pas réussir toutes
   * les deux.
   */
  async consommer(valeur: string, type: TypeJeton): Promise<User | null> {
    const jeton = await this.jetons.findOne({
      where: { empreinte: this.empreinte(valeur), type },
      relations: { user: true },
    });

    if (!jeton) {
      return null;
    }
    if (jeton.consommeLe !== null || jeton.expireLe <= new Date()) {
      return null;
    }

    // La condition « consomme_le IS NULL » fait partie de l'UPDATE lui-même :
    // c'est elle qui rend l'usage réellement unique. Deux requêtes simultanées
    // portant le même jeton ne peuvent pas être servies toutes les deux, car
    // une seule verra la ligne encore non consommée.
    const resultat = await this.jetons
      .createQueryBuilder()
      .update(JetonAuth)
      .set({ consommeLe: new Date() })
      .where('id = :id AND consomme_le IS NULL', { id: jeton.id })
      .execute();

    return resultat.affected === 1 ? jeton.user : null;
  }

  /** Purge les jetons expirés depuis longtemps : ils n'ont plus aucune valeur. */
  async purger(anterieursA: Date): Promise<number> {
    const resultat = await this.jetons.delete({
      expireLe: LessThan(anterieursA),
    });
    return resultat.affected ?? 0;
  }

  private empreinte(valeur: string): string {
    return createHash('sha256').update(valeur).digest('hex');
  }

  /**
   * Comparaison à temps constant, pour les cas où deux empreintes doivent être
   * confrontées hors requête indexée.
   */
  static empreintesIdentiques(a: string, b: string): boolean {
    const tamponA = Buffer.from(a, 'hex');
    const tamponB = Buffer.from(b, 'hex');
    return (
      tamponA.length === tamponB.length && timingSafeEqual(tamponA, tamponB)
    );
  }
}
