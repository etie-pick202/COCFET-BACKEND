# Convention de sécurité — COCFET Backend

## 1. Principes généraux

- **Défense en profondeur** : aucune protection unique ne suffit. On superpose validation, guard et contrainte en base.
- **Moindre privilège** : un composant n'accède qu'à ce qui lui est strictement nécessaire (rôle en base, portée du JWT, palier sponsor).
- **Fail secure** : en cas d'erreur ou de doute, le système refuse plutôt qu'il n'autorise.
- **Aucun détail interne exposé au client** : messages génériques côté utilisateur, détails techniques dans les journaux serveur uniquement.
- Toute PR touchant l'authentification, les permissions, les secrets, les paiements ou les en-têtes HTTP **exige une review dédiée**.

## 2. Écrire du code sécurisé

### 2.1 Validation des entrées

- Toute route reçoit ses données via un DTO annoté `class-validator` — jamais de `req.body` non typé.
- Le `ValidationPipe` global est configuré avec `whitelist: true`, `forbidNonWhitelisted: true` et `transform: true` (voir `main.ts`). Un champ inconnu provoque un rejet explicite plutôt qu'un silence.
- Valider précisément : `@IsEmail()`, `@IsUUID()`, `@Min()`/`@Max()`, `@MinLength()`. Un `@IsString()` seul ne suffit pas sur un champ métier sensible.
- **Les montants sont des entiers.** Le FCFA n'a pas de sous-unité : `@IsInt()` et jamais `@IsNumber()`, sous peine d'introduire des décimales dans une transaction.

### 2.2 Accès base de données

- TypeORM uniquement. **Aucune requête SQL brute** sans justification documentée en review.
- Toujours des paramètres liés (`.where('email = :email', { email })`), jamais de concaténation de chaînes.
- `synchronize` est conditionné à `NODE_ENV === 'development'` (voir `database.config.ts`). **Interdit en staging et en production** : cette option peut supprimer des colonnes, donc des données.

### 2.3 Authentification et mots de passe

- Mots de passe hachés avec bcrypt (12 tours), jamais stockés ni journalisés en clair.
- Le message d'erreur de connexion reste **indifférencié** : ne jamais révéler si c'est l'email qui n'existe pas ou le mot de passe qui est faux, sous peine de permettre l'énumération des comptes.
- JWT : secret d'au moins 32 caractères aléatoires, jamais commité, expiration systématique. Aucune donnée sensible dans le payload.
- Le refresh token est stocké **haché** (`User.refreshTokenHash`) et invalidé à chaque rotation.
- Un compte dont `isActive` vaut faux ne peut pas se connecter.

### 2.4 Autorisation

- `JwtAuthGuard`, `RolesGuard` et `RateLimitGuard` sont appliqués **globalement**. Une route publique se déclare explicitement avec `@Public()` : l'oubli protège, il n'expose pas.
- Vérifier l'**appartenance de la ressource** en plus du rôle : un utilisateur ne consulte que ses propres billets, commandes et notifications.
- L'accès à l'annuaire dépend du palier du sponsor (`accesAnnuaire`). Une erreur ici expose des données personnelles d'étudiants à des tiers non autorisés.

### 2.5 Gestion des erreurs

- Toute exception passe par le filtre global. Jamais de `try/catch` renvoyant `error.message` ou `error.stack` au client.
- En production, aucune stack trace, requête SQL ni chemin de fichier ne doit apparaître dans une réponse HTTP.
- Journaliser le détail complet côté serveur, renvoyer un message générique accompagné d'un identifiant de corrélation.

### 2.6 Secrets et configuration

- Aucun secret n'est commité, y compris dans `.env.example` — uniquement des placeholders.
- Chaque environnement a ses propres secrets, jamais partagés entre dev, staging et production.
- Un secret ayant transité par un canal non sécurisé (chat, email, ticket) est **compromis définitivement** : il doit être révoqué et régénéré, pas seulement retiré du code.
- Procédure complète d'obtention et de révocation : [`docs/SECRETS.md`](docs/SECRETS.md).

### 2.7 Journaux

- Ne jamais journaliser : mots de passe, jetons JWT, en-têtes d'autorisation, secrets de webhook, données personnelles d'étudiants.
- Attention aux erreurs TypeORM, qui peuvent contenir la chaîne de connexion complète.

### 2.8 Dépendances

- `pnpm run audit:security` est exécuté en CI sur chaque PR et bloque au niveau `high`.
- Le lockfile est toujours commité et à jour.
- Les CVE transitives se corrigent par `overrides` dans `pnpm-workspace.yaml`, avec justification en commentaire.
- Dependabot surveille les mises à jour de sécurité (voir `.github/dependabot.yml`).

### 2.9 Limitation de débit

- `RateLimitGuard` (Upstash Redis) est appliqué globalement. Il se **désactive silencieusement** si `UPSTASH_*` n'est pas renseigné — acceptable en local, à proscrire en production.
- Les parcours sensibles (connexion, inscription, mot de passe oublié) doivent recevoir une limitation dédiée, plus stricte que la globale.
- L'IP issue de `x-forwarded-for` n'est fiable que derrière un proxy de confiance : sans `trust proxy` correctement réglé, elle est falsifiable par le client.

### 2.10 Paiement

- **La signature des webhooks NotchPay est vérifiée systématiquement** avec `NOTCHPAY_WEBHOOK_SECRET`. Sans cette vérification, n'importe qui peut appeler l'endpoint et faire passer une commande en « payée ».
- La comparaison de signature doit résister aux attaques temporelles (comparaison à temps constant).
- Les webhooks sont **idempotents** : `Transaction.reference` porte un index unique et sert de clé. Un prestataire de paiement rejoue ses webhooks ; sans idempotence, un paiement est encaissé deux fois.
- Le montant est toujours recalculé côté serveur. **Jamais de prix reçu du client.**

## 3. Sécuriser l'application

### 3.1 En-têtes HTTP

`helmet` est actif dans `main.ts`. Toute modification doit rester cohérente avec les origines autorisées.

### 3.2 CORS

`CORS_ORIGIN` restreint explicitement les origines, par environnement. Un `enableCors()` sans configuration autoriserait **toutes** les origines.

### 3.3 HTTPS

Le trafic public passe systématiquement par HTTPS, géré par la plateforme d'hébergement. `Strict-Transport-Security` est fourni par helmet.

### 3.4 Base de données

- SSL forcé en production via `DATABASE_SSL=true`.
- Le rôle applicatif dispose du minimum de droits : **jamais de superuser en production**.

### 3.5 Surface d'attaque

- **Swagger** (`/docs`) est actuellement exposé sans restriction. Décider explicitement s'il reste public en production, ou s'il est désactivé hors développement.
- Toute route d'administration est protégée par `@Roles(Role.ADMIN)`, jamais par simple obscurité de l'URL.

### 3.6 CI/CD

- Les secrets CI sont stockés dans *Settings → Secrets and variables → Actions*, jamais en clair dans un workflow.
- Les actions GitHub sont **épinglées par SHA** et non par tag : un tag peut être redéplacé vers un commit malveillant, un SHA non.
- Analyse statique de sécurité (SAST) exécutée sur chaque PR via CodeQL.
- SonarCloud analyse la qualité et les vulnérabilités sur chaque PR.

## 4. Checklist de revue

- [ ] Aucun secret en clair dans le code, les journaux ou les tests
- [ ] Toute route sensible est protégée par les guards appropriés
- [ ] Les messages d'erreur ne révèlent aucun détail interne
- [ ] Les DTO valident strictement types, formats et longueurs
- [ ] Les montants sont des entiers, calculés côté serveur
- [ ] Les nouvelles dépendances sont justifiées et auditées
- [ ] L'appartenance de la ressource est vérifiée, pas seulement le rôle
- [ ] Aucune régression sur les compteurs dénormalisés sous accès concurrent

## 5. Signaler une vulnérabilité

Ne pas ouvrir d'issue publique. Contacter directement les mainteneurs du dépôt.
