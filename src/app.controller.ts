import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "État de santé de l'API" })
  @ApiOkResponse({ description: "L'API répond.", type: HealthStatus })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
