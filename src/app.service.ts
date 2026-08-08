import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export class HealthStatus {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status: 'ok';

  @ApiProperty({ format: 'date-time', example: '2027-08-12T18:00:00.000Z' })
  timestamp: string;
}

@Injectable()
export class AppService {
  getHealth(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
