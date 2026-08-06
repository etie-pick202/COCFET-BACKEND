import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_OPTIONNELLE_KEY } from '../decorators/auth-optionnelle.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (this.lireDrapeau(context, IS_PUBLIC_KEY)) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Sur une route à authentification optionnelle, l'échec ne bloque pas : la
   * requête poursuit sans utilisateur et le contrôleur la traite comme
   * anonyme. Ailleurs, le comportement par défaut s'applique — c'est-à-dire
   * un 401.
   *
   * Le typage suit celui de Passport, volontairement lâche ; la stratégie,
   * elle, renvoie toujours la même forme.
   */
  handleRequest<TUser = unknown>(
    erreur: unknown,
    utilisateur: unknown,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    if (
      (erreur || !utilisateur) &&
      this.lireDrapeau(context, AUTH_OPTIONNELLE_KEY)
    ) {
      return undefined as TUser;
    }

    return super.handleRequest(erreur, utilisateur, info, context, status);
  }

  private lireDrapeau(context: ExecutionContext, cle: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(cle, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}
