import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { MethodePaiement } from './enums/paiement.enum';
import {
  METHODE_FRAIS_PAR_DEFAUT,
  TauxFrais,
  tauxFraisDepuisConfig,
} from './frais-paiement';

export class BaremeFrais {
  @ApiProperty({
    example: 0.03,
    description: 'Part de Fapshi sur l’encaissement.',
  })
  fapshi: number;

  @ApiProperty({
    example: { MTN_MOMO: 0.015, ORANGE_MONEY: 0.01 },
    description: 'Taux de la provision de retrait, par opérateur.',
  })
  retraitTaux: Record<MethodePaiement, number>;

  @ApiProperty({
    example: { MTN_MOMO: 4, ORANGE_MONEY: 4 },
    description: 'Part fixe de la provision de retrait, en FCFA.',
  })
  retraitFixe: Record<MethodePaiement, number>;

  @ApiProperty({
    enum: MethodePaiement,
    description: 'Opérateur retenu tant que le payeur n’a pas choisi le sien.',
  })
  methodeParDefaut: MethodePaiement;
}

/**
 * Le barème des frais, publié pour que le prix affiché avant l'achat soit
 * celui que le serveur calculera.
 *
 * Les frais ne sont pas un secret : l'acheteur les paie. Les afficher dès le
 * catalogue évite qu'il les découvre dans le panier. Le frontal refait le
 * calcul avec ces taux — la formule est la même que celle de la commande — au
 * lieu de recopier des constantes qui dériveraient à la première variable
 * d'environnement changée.
 */
@ApiTags('Paiements')
@Controller('paiements/bareme-frais')
export class BaremeFraisController {
  private readonly taux: TauxFrais;

  constructor(config: ConfigService) {
    this.taux = tauxFraisDepuisConfig(config);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Barème des frais de paiement' })
  @ApiOkResponse({ type: BaremeFrais })
  bareme(): BaremeFrais {
    return { ...this.taux, methodeParDefaut: METHODE_FRAIS_PAR_DEFAUT };
  }
}
