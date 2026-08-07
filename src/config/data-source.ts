import 'dotenv/config';
import { DataSource } from 'typeorm';
import { optionsTls } from './tls.config';

/**
 * Source de données destinée au **CLI TypeORM** (génération et exécution des
 * migrations). Elle est volontairement séparée de la configuration consommée
 * par NestJS : le CLI s'exécute hors du conteneur d'injection et ne peut donc
 * pas résoudre `ConfigService`.
 *
 * Les deux doivent rester cohérentes — c'est pourquoi les options TLS sont
 * factorisées dans `tls.config.ts` plutôt que dupliquées.
 */
/**
 * En production, le code source n'est pas déployé : seul `dist/` l'est, et
 * `ts-node` n'y est pas installé. Les chemins doivent donc suivre la forme
 * compilée, sans quoi le CLI ne trouve aucune migration et **annonce un
 * succès** — la base reste alors au schéma précédent pendant que
 * l'application démarre en supposant le nouveau.
 */
const compile = __filename.endsWith('.js');
const extension = compile ? 'js' : 'ts';
const racine = compile ? 'dist' : 'src';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [`${racine}/**/*.entity.${extension}`],
  migrations: [`${racine}/migrations/*.${extension}`],
  // Jamais de synchronisation automatique ici : le CLI sert précisément à
  // produire les migrations qui la remplacent.
  synchronize: false,
  ssl: optionsTls(),
});
