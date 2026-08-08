import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BureauService } from '../bureau.service';
import { PRIVILEGE_KEY } from '../decorators/privilege.decorator';
import { detient, Privilege } from '../privileges';

/**
 * Applique les privilèges de poste, **côté serveur**.
 *
 * C'est ce qui sépare un cloisonnement réel d'un simple masquage d'interface :
 * cacher un widget dans le frontend n'empêche personne d'appeler l'API
 * directement. Ici, la chargée des activités reçoit un 403 sur les chiffres
 * de la trésorerie, quel que soit le client qu'elle utilise.
 *
 * Le privilège est relu à **chaque requête** plutôt que porté par le jeton :
 * un jeton vit quinze minutes, et retirer un poste à quelqu'un doit prendre
 * effet immédiatement, pas au prochain rafraîchissement.
 */
@Injectable()
export class PrivilegeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bureauService: BureauService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requis = this.reflector.getAllAndOverride<Privilege>(PRIVILEGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requis) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { id: string } }>();

    if (!user) {
      throw new ForbiddenException('Authentification requise.');
    }

    const privileges = await this.bureauService.privilegesDe(user.id);

    if (!detient(privileges, requis)) {
      // Message volontairement explicite : contrairement à une ressource dont
      // l'existence doit rester secrète, ici la personne est légitimement
      // dans le bureau. Lui dire quel poste ouvre ce droit lui évite de
      // chercher une panne là où il n'y a qu'une règle.
      throw new ForbiddenException(
        requis === Privilege.TRESORERIE
          ? 'Les chiffres de la trésorerie sont réservés aux postes qui en ont la charge.'
          : 'Seuls les postes habilités peuvent initier un retrait.',
      );
    }

    return true;
  }
}
