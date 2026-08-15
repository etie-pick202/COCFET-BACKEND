import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../common/enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: Role } }>();

    // L'exemption est posee ici, au point de passage, et non repetee dans
    // chaque controleur : une regle a venir passera par ce meme garde et
    // heritera donc de l'exemption sans que personne ait a y penser.
    if (user?.role === Role.SUPER_ADMIN) {
      return true;
    }

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits requis pour cette action",
      );
    }

    return true;
  }
}
