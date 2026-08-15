import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeNotification } from './entities/notification.entity';
import { PreferenceNotification } from './entities/preference-notification.entity';

/**
 * Point d'interrogation des réglages, pour les modules **hors** du circuit des
 * notifications.
 *
 * Plusieurs emails partent avec leur propre gabarit sans passer par
 * `NotificationService` — l'accueil d'un nouveau compte, celui d'un membre du
 * bureau. Ils ignoraient donc purement et simplement le réglage de la
 * personne, et le choix qu'on lui offrait n'en était pas un.
 *
 * **Volontairement léger.** `NotificationService` traîne le courrier et les
 * générations : le faire dépendre du bureau fermerait une boucle — bureau vers
 * notifications, notifications vers courrier, courrier vers générations,
 * générations vers bureau. Ce service ne connaît que le dépôt des réglages, ce
 * qui lui permet d'être appelé de partout.
 */
@Injectable()
export class PreferenceEmailService {
  constructor(
    @InjectRepository(PreferenceNotification)
    private readonly preferences: Repository<PreferenceNotification>,
  ) {}

  /**
   * Dit si un email de ce type peut partir vers cette personne.
   *
   * Vrai par défaut : l'absence de ligne vaut « activé », comme partout
   * ailleurs. Un nouvel arrivant reçoit donc tout, et coupe ensuite ce qu'il ne
   * veut plus — l'inverse obligerait chacun à réclamer ce qu'il attend.
   */
  async autorise(userId: string, type: TypeNotification): Promise<boolean> {
    const preference = await this.preferences.findOne({
      where: { user: { id: userId }, type },
    });

    return preference?.canalEmail !== false;
  }
}
