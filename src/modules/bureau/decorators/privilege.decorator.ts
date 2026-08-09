import { SetMetadata } from '@nestjs/common';
import { Privilege } from '../privileges';

export const PRIVILEGE_KEY = 'privilege';

/**
 * Exige un privilège de poste, en plus du rôle.
 *
 * À combiner avec `@Roles(Role.ADMIN)` : le rôle dit qu'on administre la
 * plateforme, le privilège dit ce qu'on a le droit de savoir ou de faire.
 * Les deux gardes s'appliquent, et le plus restrictif l'emporte.
 */
export const ExigePrivilege = (privilege: Privilege) =>
  SetMetadata(PRIVILEGE_KEY, privilege);
