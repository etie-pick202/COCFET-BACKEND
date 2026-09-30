import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service';
import { SansLimiteDebit } from './common/guards/limite-debit.decorator';
import { Public } from './modules/auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @SansLimiteDebit()
  @Get()
  @ApiOperation({ summary: "État de santé de l'API" })
  @ApiOkResponse({ description: "L'API répond.", type: HealthStatus })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
