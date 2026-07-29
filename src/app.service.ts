import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class AppService {
  getHealth(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
