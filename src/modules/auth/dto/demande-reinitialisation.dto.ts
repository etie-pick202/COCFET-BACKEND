import { EstUnEmail } from '../../../common/validation/email.decorator';

export class DemandeReinitialisationDto {
  @EstUnEmail()
  email: string;
}
