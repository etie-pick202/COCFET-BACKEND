import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '../../../common/enums/role.enum';
import { UserService } from '../../user/user.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /**
   * Identifiant unique du jeton.
   *
   * Sans lui, deux jetons signés dans la même seconde avec la même charge
   * utile sont **identiques** — `iat` étant exprimé en secondes. La rotation
   * du refresh token ne rotait alors rien, et un jeton volé restait accepté
   * après renouvellement.
   */
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}
