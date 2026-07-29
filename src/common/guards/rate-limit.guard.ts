import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Request } from 'express';

/**
 * Limitation de débit distribuée (Upstash Redis), appliquée par IP.
 * Inactive tant que les variables UPSTASH_* ne sont pas renseignées, afin de
 * ne pas bloquer le développement local ni la CI.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly ratelimit: Ratelimit | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('UPSTASH_REDIS_REST_URL');
    const token = config.get<string>('UPSTASH_REDIS_REST_TOKEN');

    if (!url || !token) {
      this.logger.warn(
        'Upstash non configuré — la limitation de débit est désactivée',
      );
      this.ratelimit = null;
      return;
    }

    this.ratelimit = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(
        config.get<number>('RATE_LIMIT_REQUESTS', 100),
        `${config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60)} s`,
      ),
      analytics: true,
      prefix: 'cocfet',
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.ratelimit) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const identifier = request.ip ?? 'anonymous';
    const { success } = await this.ratelimit.limit(identifier);

    if (!success) {
      throw new HttpException(
        'Trop de requêtes, veuillez réessayer plus tard',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
