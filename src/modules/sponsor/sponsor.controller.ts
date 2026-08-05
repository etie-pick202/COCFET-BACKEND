import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationDto, ResultatPagine } from '../../common/pagination';
import { Role } from '../../common/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { InviterSponsorDto } from './dto/inviter-sponsor.dto';
import { Sponsor } from './entities/sponsor.entity';
import { SponsorService } from './sponsor.service';

@ApiTags('Sponsors')
@ApiBearerAuth()
@Controller('sponsors')
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) {}

  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Inviter un partenaire',
    description:
      "Réservé au bureau : un sponsor ne s'inscrit jamais de lui-même. Le " +
      'compte est créé sans mot de passe, et le partenaire choisit le sien en ' +
      "suivant le lien reçu. Aucun mot de passe n'est généré ni transmis.",
  })
  @ApiResponse({
    status: 201,
    description: 'Partenaire créé, invitation envoyée.',
  })
  @ApiResponse({
    status: 409,
    description: 'Un compte utilise déjà cette adresse.',
  })
  inviter(@Body() dto: InviterSponsorDto): Promise<Sponsor> {
    return this.sponsorService.inviter(dto);
  }

  @Roles(Role.ADMIN)
  @Post(':id/reinviter')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Renvoyer une invitation',
    description:
      'Le lien précédent cesse aussitôt d’être utilisable : un jeton ' +
      'communiqué par erreur est ainsi révoqué en réémettant l’invitation.',
  })
  reinviter(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sponsorService.reinviter(id);
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Lister les partenaires' })
  lister(@Query() pagination: PaginationDto): Promise<ResultatPagine<Sponsor>> {
    return this.sponsorService.lister(pagination);
  }
}
