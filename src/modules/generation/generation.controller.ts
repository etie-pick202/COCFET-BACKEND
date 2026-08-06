import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreerGenerationDto,
  MettreAJourGenerationDto,
  ThemeGeneration,
} from './dto/generation.dto';
import { Generation } from './entities/generation.entity';
import { GenerationService } from './generation.service';

@ApiTags('Générations')
@Controller('generations')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  @Public()
  @Get('theme')
  @ApiOperation({
    summary: 'Thème de la génération en cours',
    description:
      "Chargé au démarrage du frontend pour s'habiller. Renvoie des valeurs " +
      "neutres plutôt qu'une erreur quand aucune génération n'est active : " +
      'une plateforme fraîchement installée doit pouvoir s’afficher.',
  })
  theme(): Promise<ThemeGeneration> {
    return this.generationService.theme();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Lister les générations' })
  lister(): Promise<Generation[]> {
    return this.generationService.lister();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Consulter une génération' })
  trouver(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    return this.generationService.trouver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Créer une génération',
    description:
      "Créée inactive : l'activation bascule toute la plateforme et mérite un " +
      'geste explicite.',
  })
  @ApiResponse({ status: 409, description: 'Cette année existe déjà.' })
  creer(@Body() dto: CreerGenerationDto): Promise<Generation> {
    return this.generationService.creer(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une génération' })
  @ApiResponse({
    status: 409,
    description: 'Génération archivée, ou année déjà prise.',
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourGenerationDto,
  ): Promise<Generation> {
    return this.generationService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/activer')
  @ApiOperation({
    summary: 'Activer une génération',
    description:
      'Désactive la précédente et recalcule le statut de finissant de toute ' +
      'la plateforme, dans une seule transaction. Deux générations actives ' +
      'rendraient le thème et la tarification indéterminés.',
  })
  @ApiResponse({ status: 409, description: 'Génération archivée.' })
  activer(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    return this.generationService.activer(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/archiver')
  @ApiOperation({
    summary: 'Archiver une génération',
    description:
      'Fige les statistiques du mandat. Elles sont calculées à cet instant et ' +
      'ne bougent plus : les recalculer plus tard donnerait des chiffres ' +
      'différents, et le bilan ne serait jamais deux fois le même.',
  })
  @ApiResponse({
    status: 409,
    description: 'La génération est en cours de mandat.',
  })
  archiver(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    return this.generationService.archiver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer une génération',
    description:
      'Réservé à une génération créée par erreur : ni la génération en cours, ' +
      'ni une archive, qui conserve le bilan de son mandat.',
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.generationService.supprimer(id);
  }
}
