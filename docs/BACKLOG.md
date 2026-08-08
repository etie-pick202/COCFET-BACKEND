# Backlog COCFET — Backend

Backlog dérivé de l'état réel du code : 18 entités et 4 services sont en place, mais aucun contrôleur ni DTO n'existe encore. L'essentiel de la surface API reste donc à construire.

**Import dans Jira** — le fichier `docs/jira-import.csv` s'importe depuis *Paramètres → Système → Importer des données externes → CSV*. Mapper `Epic Link` sur le lien d'epic et `Fix Version` sur la version de correction. Les epics doivent être importés avant les récits, ce que l'ordre du fichier respecte déjà.

## Vue d'ensemble

| | Total | MVP |
|---|---|---|
| Epics | 17 | — |
| Récits | 125 | 84 |
| Points | 533 | 363 |

| # | Epic | Récits | Points | Points MVP |
|---|---|---|---|---|
| 1 | Socle technique et migrations | 8 | 29 | 21 |
| 2 | Authentification et comptes | 10 | 44 | 33 |
| 3 | Utilisateurs et profils | 5 | 17 | 11 |
| 4 | Générations | 5 | 18 | 8 |
| 5 | Événements | 9 | 37 | 26 |
| 6 | Billetterie et contrôle d'accès | 10 | 43 | 37 |
| 7 | Paiement Mobile Money | 9 | 44 | 31 |
| 8 | Boutique | 6 | 24 | 19 |
| 9 | Commandes et retrait | 7 | 32 | 24 |
| 10 | Sondages et votes | 8 | 34 | 31 |
| 11 | Articles et actualités | 6 | 20 | 13 |
| 12 | Annuaire des finissants | 6 | 26 | 26 |
| 13 | Sponsors et accréditations | 9 | 39 | 21 |
| 14 | Notifications et rappels | 8 | 39 | 13 |
| 15 | Fichiers et médias | 4 | 18 | 10 |
| 16 | Tableau de bord administrateur | 6 | 24 | 10 |
| 17 | Qualité, sécurité et observabilité | 9 | 45 | 29 |

## Séquencement

Les dépendances dures, à respecter dans cet ordre :

1. **Socle technique** — les migrations conditionnent tout le reste. Tant que `synchronize` est actif, aucun déploiement n'est sûr.
2. **Authentification** — tout endpoint protégé en dépend, et la déduction du rôle depuis l'email universitaire conditionne la tarification.
3. **Générations** — l'unicité de la génération active conditionne le thème et les rattachements.
4. **Événements**, puis **Billetterie**, puis **Paiement** — la billetterie n'a de sens qu'avec le paiement, et le paiement suppose la tarification résolue.
5. **Boutique**, puis **Commandes** — même dépendance au paiement.
6. **Sponsors** avant **Annuaire** — l'accès à l'annuaire est gouverné par les paliers d'accréditation.

## Points de vigilance

Ces sujets sont déjà identifiables dans le code et méritent d'être traités tôt, parce qu'ils coûtent cher à rattraper :

- **`synchronize` actif** — peut supprimer des colonnes, donc des données, en production.
- **Compteurs dénormalisés** — `inscriptionsActuelles`, `totalVotes`, `OptionSondage.votes` et `StatistiquesSponsor` accélèrent l'affichage, mais s'écartent du réel dès qu'un chemin d'écriture les oublie.
- **Webhooks de paiement** — sans vérification de signature, n'importe qui peut marquer une commande comme payée. Sans idempotence, un rejeu la paie deux fois.
- **Concurrence** — `capaciteMax` et `Produit.stock` se laissent dépasser si la vérification et l'écriture ne sont pas atomiques.
- **Sondages anonymes** — l'index unique `(sondage, user)` ne protège rien lorsque `user` est nul.
- **CV et données personnelles** — l'annuaire expose des données d'étudiants à des entreprises. Les URL signées et les quotas ne sont pas optionnels.
- **Montants en FCFA** — devise sans sous-unité, stockée en entier. Aucun calcul ne doit introduire de décimale.

## Détail des epics

### 1. Socle technique et migrations

Fondations transverses : migrations, configuration, conventions d'erreur et de pagination. Bloque la quasi-totalité des autres épopées.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Remplacer synchronize par des migrations TypeORM versionnées | 5 | Highest | MVP |
| Générer la migration initiale du schéma | 3 | Highest | MVP |
| Ajouter PostgreSQL au docker-compose | 2 | High | MVP |
| Valider la configuration au démarrage | 3 | High | MVP |
| Unifier le format des erreurs | 3 | High | MVP |
| Factoriser la pagination, le tri et le filtrage | 5 | High | MVP |
| Créer un jeu de données de développement | 3 | Medium | V1 |
| Arbitrer la politique de suppression et de conservation | 5 | Medium | V1 |

**Remplacer synchronize par des migrations TypeORM versionnées**

Le schéma est actuellement généré par `synchronize`. En production, cette option peut supprimer des colonnes, et donc des données. Il faut passer à des migrations versionnées et désactiver `synchronize` en dehors du développement.

- `synchronize` vaut false en staging et en production
- Les scripts `migration:generate`, `migration:run` et `migration:revert` existent
- La CI échoue si une entité est modifiée sans migration correspondante

**Générer la migration initiale du schéma**

Produire la première migration couvrant les 18 entités existantes, tables de jointure incluses (`evenement_sponsors`, `vote_options`).

- `migration:run` crée le schéma complet depuis une base vide
- `migration:revert` le supprime proprement
- Les index uniques sont présents : `users.email`, `inscriptions.code_billet`, `transactions.reference`, `articles.slug`, `generations.annee`, `votes(sondage, user)`

**Ajouter PostgreSQL au docker-compose**

Le `docker-compose.yml` ne contient que Mailpit, PostgreSQL y est commenté. Un nouvel arrivant doit pouvoir démarrer la base sans installation locale.

- `docker compose up -d` démarre PostgreSQL et Mailpit
- Les identifiants correspondent à ceux du `.env.example`
- Un volume nommé assure la persistance des données

**Valider la configuration au démarrage**

Compléter `env.validation.ts` pour que l'API refuse de démarrer si une variable requise manque ou est mal typée, plutôt que d'échouer plus tard à l'exécution.

- Toute variable absente ou invalide provoque un échec explicite au démarrage
- Le message d'erreur nomme la variable fautive
- Les valeurs par défaut de développement restent fonctionnelles

**Unifier le format des erreurs**

Mettre en place un filtre d'exception global. Toutes les erreurs doivent sortir sous la même forme, sans jamais laisser fuiter de trace technique vers le client.

- Réponse unifiée : code, message, horodatage, chemin
- Les erreurs 500 sont journalisées intégralement mais renvoient un message générique
- Les erreurs de validation listent les champs invalides

**Factoriser la pagination, le tri et le filtrage**

Toutes les listes (événements, produits, articles, annuaire, utilisateurs) ont besoin de la même mécanique. La factoriser évite de la réécrire dans chaque module.

- DTO de pagination commun, avec une borne maximale sur la taille de page
- Réponse enveloppée : données, total, page, nombre de pages
- Tri restreint à une liste blanche de champs, pour éviter l'injection dans la clause ORDER BY

**Créer un jeu de données de développement**

Un script de seed permettant de disposer d'une base représentative sans saisie manuelle.

- Crée une génération active, des utilisateurs de chaque rôle, des événements, des produits, des sondages et des articles
- Idempotent : deux exécutions ne dupliquent rien
- Jamais exécutable en production

**Arbitrer la politique de suppression et de conservation**

Choisir entre suppression physique et suppression logique pour chaque entité, en cohérence avec les `onDelete` déjà posés (CASCADE, SET NULL, RESTRICT).

- Chaque entité a une politique documentée
- La suppression d'un utilisateur préserve la traçabilité comptable des transactions
- Les règles sont couvertes par des tests

### 2. Authentification et comptes

Inscription, connexion, jetons, rôles et SSO universitaire. Prérequis de tous les endpoints protégés.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Inscrire un utilisateur par email et mot de passe | 3 | Highest | MVP |
| Émettre les jetons à la connexion | 5 | Highest | MVP |
| Faire tourner et révoquer le refresh token | 5 | Highest | MVP |
| Déduire le rôle et la promotion depuis l'email universitaire | 5 | High | MVP |
| Déconnecter un utilisateur | 2 | High | MVP |
| Réinitialiser un mot de passe oublié | 5 | High | MVP |
| Vérifier l'adresse email | 3 | Medium | V1 |
| Brancher le SSO UCAC-ICAM | 8 | Medium | V1 |
| Durcir les endpoints d'authentification | 5 | High | MVP |
| Couvrir les guards de rôles par des tests | 3 | High | MVP |

**Inscrire un utilisateur par email et mot de passe**

Créer le DTO et l'endpoint d'inscription. `passwordHash` est nullable en base pour les comptes SSO, mais il est obligatoire sur ce parcours.

- Mot de passe haché avec bcrypt, jamais stocké en clair
- Email unique : un doublon renvoie une erreur explicite
- La politique de robustesse du mot de passe est appliquée et documentée
- L'email de bienvenue part via `MailService`

**Émettre les jetons à la connexion**

Endpoint de connexion renvoyant un access token de courte durée et un refresh token de longue durée.

- Des identifiants invalides donnent un message indifférencié, pour ne pas révéler l'existence d'un compte
- Un compte dont `isActive` vaut false ne peut pas se connecter
- Les durées de validité sont configurables

**Faire tourner et révoquer le refresh token**

`User.refreshTokenHash` existe déjà. Il doit servir à invalider un refresh token dès qu'il est réutilisé, afin de limiter l'impact d'un vol de jeton.

- Le refresh token est stocké haché, jamais en clair
- Chaque rafraîchissement émet un nouveau couple et invalide le précédent
- Rejouer un ancien refresh token échoue

**Déduire le rôle et la promotion depuis l'email universitaire**

Un email du domaine universitaire donne le rôle STUDENT et renseigne la promotion (par exemple 2027), ce qui conditionne le tarif campus. Tout autre domaine donne VISITOR.

- Le domaine universitaire attribue STUDENT et renseigne `promotion`
- Les autres domaines donnent VISITOR
- La règle d'extraction est couverte par des tests, cas limites inclus
- Le rôle ADMIN n'est jamais attribuable par ce mécanisme

**Déconnecter un utilisateur**

Invalider le refresh token côté serveur, pour que la déconnexion ne repose pas seulement sur l'oubli du jeton par le client.

- `refreshTokenHash` est effacé
- Le refresh token devient inutilisable
- L'endpoint est idempotent

**Réinitialiser un mot de passe oublié**

Le template `password-reset.hbs` existe déjà. Il manque le parcours complet : demande, jeton à durée limitée, changement effectif.

- Le lien expire au bout d'une heure, conformément au template
- Le jeton est à usage unique
- La demande renvoie la même réponse, que l'email existe ou non
- Le changement invalide les sessions en cours

**Vérifier l'adresse email**

Confirmer la possession de l'adresse avant d'accorder les droits liés au statut étudiant.

- Un email de vérification part à l'inscription
- Le lien est à usage unique et expire
- Les actions réservées aux comptes vérifiés sont documentées

**Brancher le SSO UCAC-ICAM**

Connexion via le fournisseur d'identité de l'école. C'est la raison pour laquelle `passwordHash` est nullable.

- Un compte créé par SSO a un `passwordHash` nul et ne peut pas se connecter par mot de passe
- Le rattachement à un compte existant de même email est traité explicitement
- Le rôle et la promotion sont dérivés des attributs fournis par le fournisseur d'identité

**Durcir les endpoints d'authentification**

Le `rate-limit.guard.ts` existe. Il faut l'appliquer aux parcours sensibles et ajouter une temporisation après des échecs répétés.

- Limitation par IP et par compte sur la connexion, l'inscription et le mot de passe oublié
- Temporisation progressive après plusieurs échecs consécutifs
- Les tentatives échouées sont journalisées

**Couvrir les guards de rôles par des tests**

`JwtAuthGuard`, `RolesGuard`, `@Roles` et `@Public` sont en place mais ne sont pas testés. Une régression ici ouvre l'accès à des données privées.

- Chaque combinaison rôle / endpoint est testée
- Un endpoint sans `@Public` est protégé par défaut
- Un jeton expiré ou falsifié est rejeté

### 3. Utilisateurs et profils

Gestion des comptes, par l'administration et par l'utilisateur lui-même.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Administrer les utilisateurs | 5 | High | MVP |
| Consulter et modifier son profil | 3 | High | MVP |
| Changer son mot de passe | 3 | Medium | MVP |
| Rechercher et filtrer les utilisateurs | 3 | Medium | V1 |
| Piloter le marquage des finissants | 3 | Medium | V1 |

**Administrer les utilisateurs**

Endpoints d'administration : lister, consulter, modifier le rôle, désactiver.

- Réservé au rôle ADMIN
- La désactivation passe `isActive` à false sans supprimer l'historique
- Un administrateur ne peut pas se retirer lui-même son rôle

**Consulter et modifier son profil**

Endpoints de lecture et de mise à jour du profil de l'utilisateur connecté.

- Ne renvoie jamais `passwordHash` ni `refreshTokenHash`
- Les champs `role`, `promotion` et `isFinissant` ne sont pas modifiables par l'utilisateur
- Changer d'email exige une nouvelle vérification

**Changer son mot de passe**

Changement par un utilisateur déjà connecté, avec vérification du mot de passe actuel.

- Le mot de passe actuel est exigé
- Les autres sessions sont invalidées
- Indisponible pour les comptes SSO dépourvus de mot de passe

**Rechercher et filtrer les utilisateurs**

Permettre au bureau de retrouver un compte par rôle, promotion ou statut de finissant.

- Filtres sur `role`, `promotion`, `isFinissant` et `isActive`
- Recherche textuelle sur le nom et l'email
- Pagination appliquée

**Piloter le marquage des finissants**

`isFinissant` conditionne l'appartenance à l'annuaire. Ce marquage doit découler de la génération active, et non d'une saisie manuelle.

- Le passage à une nouvelle génération met à jour les finissants
- L'opération est tracée dans le journal d'activité
- Une correction manuelle reste possible pour un administrateur

### 4. Générations

Une génération correspond au mandat d'un Bureau des Finissants. L'archivage fige les statistiques et fait basculer la plateforme.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les générations | 3 | High | MVP |
| Garantir l'unicité de la génération active | 3 | Highest | MVP |
| Archiver une génération et figer ses statistiques | 5 | High | V1 |
| Exposer le thème de la génération active | 2 | Medium | MVP |
| Basculer vers une nouvelle génération | 5 | Medium | V1 |

**Gérer les générations**

Création, modification et consultation des générations : année, nom, logo, couleurs.

- `annee` est unique
- Réservé au rôle ADMIN
- Les couleurs sont validées comme codes hexadécimaux

**Garantir l'unicité de la génération active**

`isActive` est un simple booléen : rien n'empêche aujourd'hui deux générations actives, ce qui rendrait le thème et les rattachements indéterminés.

- Activer une génération désactive automatiquement la précédente
- L'invariant est garanti en base par un index partiel unique, pas seulement en code
- L'opération est transactionnelle

**Archiver une génération et figer ses statistiques**

L'archivage calcule puis fige `stats` (totalEvents, totalRevenue, totalUsers, totalProducts) et renseigne `archivedAt`.

- Les statistiques sont calculées à l'archivage et ne bougent plus ensuite
- `archivedAt` est renseigné
- Une génération archivée n'est plus modifiable

**Exposer le thème de la génération active**

Le frontend a besoin du logo et des couleurs de la génération en cours.

- Endpoint public renvoyant le logo et les couleurs de la génération active
- La réponse est mise en cache
- Le comportement est défini lorsqu'aucune génération n'est active

**Basculer vers une nouvelle génération**

Séquencer les effets de bord d'un changement de mandat : finissants, annuaire, contenus rattachés.

- La procédure est documentée et rejouable
- Les événements et contenus de l'ancienne génération restent consultables
- L'opération est tracée

### 5. Événements

Cœur du produit : catalogue, publication, tarification double et jauge de capacité.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les événements | 5 | Highest | MVP |
| Lister publiquement les événements | 5 | Highest | MVP |
| Afficher le détail d'un événement | 3 | Highest | MVP |
| Encadrer le workflow de publication | 3 | High | MVP |
| Résoudre le tarif selon le profil | 5 | Highest | MVP |
| Fiabiliser le compteur d'inscriptions | 5 | High | MVP |
| Alimenter la galerie et le compte rendu | 3 | Low | V2 |
| Rattacher des sponsors à un événement | 3 | Medium | V1 |
| Gérer les événements sur invitation | 5 | Medium | V2 |

**Gérer les événements**

Création, modification et suppression par le bureau.

- Réservé au rôle ADMIN
- `dateFin` doit être postérieure à `dateDebut`
- Un événement ayant des inscriptions ne peut pas être supprimé, seulement archivé

**Lister publiquement les événements**

Liste paginée et filtrable, accessible sans authentification.

- Seuls les événements PUBLIE sont visibles publiquement
- Filtres par type, par période et par génération
- Tri par date de début par défaut

**Afficher le détail d'un événement**

Fiche complète, avec les sponsors, les produits rattachés et les places restantes.

- Renvoie la jauge : capacité et inscriptions actuelles
- Un BROUILLON n'est accessible qu'à un administrateur
- Inclut les sponsors et les produits associés

**Encadrer le workflow de publication**

Transitions de BROUILLON vers PUBLIE puis ARCHIVE, avec les règles associées.

- Les transitions autorisées sont explicites, les autres sont refusées
- La publication exige que les champs obligatoires soient renseignés
- L'archivage ferme les inscriptions

**Résoudre le tarif selon le profil**

`prixCampus` et `prixExterne` doivent être arbitrés selon le rôle : STUDENT paie le tarif campus, VISITOR le tarif externe. Les montants sont en FCFA, stockés en entier, la devise n'ayant pas de sous-unité.

- Le tarif appliqué découle du rôle, jamais d'un paramètre envoyé par le client
- Le prix retenu est figé dans `Inscription.prix`
- Un événement GRATUIT ignore les deux tarifs
- La règle est couverte par des tests pour chaque rôle

**Fiabiliser le compteur d'inscriptions**

`inscriptionsActuelles` est dénormalisé pour afficher la jauge sans recompter les inscriptions. Il peut donc s'écarter du réel : il faut un mécanisme de cohérence et de réconciliation.

- Le compteur est mis à jour dans la même transaction que l'inscription
- Une annulation le décrémente
- Une commande de réconciliation permet de le recalculer
- Un test vérifie la cohérence sous accès concurrents

**Alimenter la galerie et le compte rendu**

Renseigner `galerie` et `recap` une fois l'événement passé.

- Ajout et suppression d'images dans la galerie
- Le compte rendu accepte du texte enrichi, assaini avant stockage
- Visible publiquement une fois l'événement terminé

**Rattacher des sponsors à un événement**

Gérer la relation plusieurs-à-plusieurs `evenement_sponsors`.

- Ajout et retrait de sponsors sur un événement
- Affichage ordonné par palier
- Réservé au rôle ADMIN

**Gérer les événements sur invitation**

Le type SUR_INVITATION existe, mais aucun mécanisme d'invitation n'est défini.

- Génération et envoi d'invitations nominatives
- L'inscription est refusée sans invitation valide
- Une invitation est à usage unique

### 6. Billetterie et contrôle d'accès

Inscription aux événements, billet à QR code et scan à l'entrée. Les règles de concurrence y sont critiques.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Créer une inscription et son code de billet | 5 | Highest | MVP |
| Générer le QR code du billet | 5 | Highest | MVP |
| Empêcher la double inscription | 3 | Highest | MVP |
| Contrôler la capacité sans surréservation | 8 | Highest | MVP |
| Scanner un billet à l'entrée | 5 | Highest | MVP |
| Annuler une inscription | 5 | High | MVP |
| Lister ses billets | 3 | High | MVP |
| Envoyer le billet par email | 3 | High | MVP |
| Exporter la liste des participants | 3 | Medium | V1 |
| Calculer les statistiques de fréquentation | 3 | Low | V2 |

**Créer une inscription et son code de billet**

`codeBillet` porte un index unique. Il doit être imprévisible : un code devinable permettrait de fabriquer un faux billet.

- Le code est généré de façon cryptographiquement aléatoire
- L'unicité est garantie, avec gestion du cas de collision
- Le statut initial est EN_ATTENTE
- Le prix est figé selon le rôle de l'utilisateur

**Générer le QR code du billet**

Alimenter `qrCode` à partir de `codeBillet`.

- Le QR encode une référence vérifiable, pas des données personnelles
- Généré après confirmation du paiement
- Lisible par les lecteurs courants

**Empêcher la double inscription**

Aucune contrainte n'empêche aujourd'hui un utilisateur de s'inscrire deux fois au même événement.

- Contrainte d'unicité en base sur le couple (user, evenement)
- L'erreur renvoyée est explicite
- Une inscription ANNULEE n'empêche pas une nouvelle inscription

**Contrôler la capacité sans surréservation**

Sous inscriptions simultanées, une simple lecture suivie d'une écriture laisse dépasser `capaciteMax`. Il faut un verrouillage ou une contrainte en base.

- La capacité n'est jamais dépassée, même sous accès concurrents
- Un test concurrent valide l'invariant
- Le refus renvoie une erreur métier claire
- `capaciteMax` à zéro signifie illimité, et c'est documenté

**Scanner un billet à l'entrée**

Endpoint de contrôle d'accès passant le billet en UTILISEE et renseignant `scannedAt`.

- Un billet déjà UTILISEE est refusé, avec la date du premier scan
- Un billet ANNULEE ou non payé est refusé
- Réservé aux rôles habilités
- Le résultat reste correct si deux lecteurs scannent simultanément

**Annuler une inscription**

Annulation par l'utilisateur ou par le bureau, avec libération de la place.

- Le statut passe à ANNULEE et la place est libérée
- Un billet déjà scanné ne peut pas être annulé
- Les règles de remboursement sont documentées

**Lister ses billets**

Liste des inscriptions de l'utilisateur connecté.

- Filtrable par statut et par période
- Inclut le QR code des billets confirmés
- Un utilisateur ne voit que ses propres billets

**Envoyer le billet par email**

Envoi du billet une fois le paiement confirmé.

- Le QR code est présent dans l'email
- Un échec d'envoi n'annule pas l'inscription
- Un nouvel envoi est possible à la demande

**Exporter la liste des participants**

Export destiné à l'accueil, le jour de l'événement.

- Export CSV incluant le statut de paiement et celui de scan
- Réservé au rôle ADMIN
- L'export est journalisé, car il contient des données personnelles

**Calculer les statistiques de fréquentation**

Taux de présence par événement, à partir des billets scannés.

- Nombre d'inscrits, nombre de présents et taux de présence
- Répartition entre campus et externes
- Disponible après l'événement

### 7. Paiement Mobile Money

Intégration Fapshi (Orange Money, MTN MoMo). L'idempotence et la vérification de signature sont ici des sujets de sécurité, pas de confort.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Initier un paiement | 8 | Highest | MVP |
| Vérifier la signature des webhooks | 5 | Highest | MVP |
| Rendre les webhooks idempotents | 5 | Highest | MVP |
| Formaliser la machine à états des paiements | 5 | Highest | MVP |
| Réconcilier les paiements | 5 | High | V1 |
| Consulter le journal des transactions | 3 | High | MVP |
| Gérer les échecs et permettre la relance | 5 | High | MVP |
| Expirer les paiements en attente | 3 | Medium | V1 |
| Tracer les remboursements | 5 | Low | V2 |

**Initier un paiement**

Intégrer Fapshi pour lancer un paiement Mobile Money et créer la `Transaction` associée.

- La transaction est créée avant l'appel au prestataire
- `reference` est renseignée et unique
- `origine` distingue EVENEMENT et BOUTIQUE
- Les erreurs du prestataire sont tracées sans exposer de secret

**Vérifier la signature des webhooks**

Sans vérification, n'importe qui peut appeler l'endpoint et faire passer une commande en payée. Le risque est déjà signalé dans `docs/SECRETS.md`.

- L'origine est authentifiée par `x-wh-secret`, et le statut revérifié auprès du prestataire — Fapshi ne signant pas le corps de ses notifications
- Une signature absente ou invalide renvoie 401 sans aucun traitement
- La comparaison résiste aux attaques temporelles
- Les rejets sont journalisés

**Rendre les webhooks idempotents**

Un prestataire de paiement rejoue ses webhooks. Sans idempotence, un même paiement peut confirmer deux fois une commande ou décrémenter deux fois le stock.

- `Transaction.reference` sert de clé d'idempotence
- Un webhook rejoué ne produit aucun effet supplémentaire
- Le traitement est transactionnel
- Un test rejoue le même webhook et vérifie l'absence de doublon

**Formaliser la machine à états des paiements**

Expliciter les transitions de `StatutPaiement` (EN_ATTENTE, COMPLETE, ECHOUE) et leur propagation vers l'inscription ou la commande.

- Les transitions autorisées sont explicites, les autres sont refusées
- Aucune transition n'est possible depuis COMPLETE
- La propagation vers `Inscription` et `Commande` est couverte par des tests

**Réconcilier les paiements**

Un webhook peut ne jamais arriver. Il faut pouvoir interroger activement le prestataire pour trancher.

- Vérification à la demande du statut réel d'une transaction
- Tâche planifiée sur les transactions en attente depuis trop longtemps
- Les écarts constatés sont signalés

**Consulter le journal des transactions**

Endpoints de consultation pour le bureau, toutes origines confondues.

- Filtres par origine, statut, méthode et période
- Réservé au rôle ADMIN
- Pagination appliquée

**Gérer les échecs et permettre la relance**

Un paiement échoué doit pouvoir être relancé sans recréer l'inscription ou la commande.

- Un échec laisse l'inscription ou la commande en attente, sans la détruire
- La relance réutilise le même panier
- L'utilisateur est informé de la cause lorsqu'elle est connue

**Expirer les paiements en attente**

Sans expiration, les places et le stock restent bloqués indéfiniment par des paniers abandonnés.

- Le délai d'expiration est configurable
- L'expiration libère la place et le stock
- L'utilisateur est notifié

**Tracer les remboursements**

Permettre à un administrateur d'enregistrer un remboursement, même réalisé hors plateforme.

- Un remboursement est tracé comme une transaction liée à l'originale
- Réservé au rôle ADMIN et tracé dans le journal d'activité
- Le statut de l'inscription ou de la commande est mis à jour

### 8. Boutique

Catalogue de produits dérivés, avec variantes, stock et précommandes.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les produits | 5 | High | MVP |
| Exposer le catalogue public | 3 | High | MVP |
| Afficher le détail d'un produit | 3 | High | MVP |
| Gérer le stock et le passage en rupture | 5 | High | MVP |
| Gérer les précommandes | 5 | Medium | V1 |
| Appliquer la tarification double aux produits | 3 | High | MVP |

**Gérer les produits**

Gestion du catalogue par le bureau.

- Réservé au rôle ADMIN
- Les tarifs campus et externe sont validés
- Les variantes de tailles et de couleurs sont gérées

**Exposer le catalogue public**

Liste paginée et filtrable des produits.

- Les produits RETIRE ne sont pas visibles publiquement
- Filtres par catégorie, par statut et par événement rattaché
- Pagination appliquée

**Afficher le détail d'un produit**

Fiche produit avec images, variantes et disponibilité.

- Renvoie les tailles et couleurs disponibles
- Indique la disponibilité réelle à partir du stock
- Renvoie le tarif applicable au profil du visiteur

**Gérer le stock et le passage en rupture**

Le champ `stock` doit piloter automatiquement le statut RUPTURE.

- Le statut passe à RUPTURE lorsque le stock atteint zéro
- Le réapprovisionnement remet le produit en DISPONIBLE
- Le stock ne peut jamais devenir négatif

**Gérer les précommandes**

Le statut PRECOMMANDE et le champ `datePrecommande` existent sans logique associée.

- Une précommande est acceptée même sans stock disponible
- La date de disponibilité prévue est affichée
- Les clients sont notifiés à la mise à disposition

**Appliquer la tarification double aux produits**

Appliquer la même règle campus / externe que pour les événements.

- Le tarif découle du rôle, jamais d'un paramètre du client
- Le prix retenu est figé dans la ligne de commande
- La règle est couverte par des tests

### 9. Commandes et retrait

Panier, paiement, préparation et retrait sur le campus.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Créer une commande | 8 | Highest | MVP |
| Figer le prix unitaire à la commande | 3 | Highest | MVP |
| Décrémenter le stock sans survente | 5 | Highest | MVP |
| Encadrer le workflow de la commande | 5 | High | MVP |
| Lister ses commandes | 3 | High | MVP |
| Générer la facture | 5 | Medium | V1 |
| Notifier la mise à disposition | 3 | Medium | V1 |

**Créer une commande**

Transformer un panier en commande et en lignes de commande, au sein d'une seule transaction.

- Le total est calculé côté serveur, jamais reçu du client
- La disponibilité est vérifiée ligne par ligne
- La commande et ses lignes sont créées de façon transactionnelle
- Une commande vide est refusée

**Figer le prix unitaire à la commande**

`LigneCommande.prix` existe précisément pour que le tarif du produit puisse évoluer sans modifier les commandes déjà passées.

- Le prix unitaire est copié à la création de la ligne
- Modifier le produit ensuite ne change aucune commande existante
- Le total de la commande reste cohérent avec ses lignes

**Décrémenter le stock sans survente**

Deux commandes simultanées portant sur le dernier article ne doivent pas aboutir toutes les deux.

- Décrément atomique, protégé contre la concurrence
- Le stock ne devient jamais négatif
- Un test concurrent valide l'invariant
- L'annulation restitue le stock

**Encadrer le workflow de la commande**

Transitions entre EN_ATTENTE, PAYEE, PRETE, RETIREE et ANNULEE.

- Les transitions autorisées sont explicites
- Le passage à PAYEE découle du paiement confirmé, jamais d'une action manuelle seule
- Le passage à RETIREE est tracé avec son auteur

**Lister ses commandes**

Liste et détail des commandes de l'utilisateur connecté.

- Un utilisateur ne voit que ses propres commandes
- Le détail inclut les lignes et le statut de paiement
- Filtrable par statut

**Générer la facture**

`Commande.factureUrl` attend un document généré et stocké.

- Facture PDF générée à la confirmation du paiement
- Stockée sur R2 et accessible par URL signée
- Accessible au seul titulaire de la commande et aux administrateurs

**Notifier la mise à disposition**

Prévenir le client lorsque sa commande passe en PRETE.

- Notification in-app et email au passage en PRETE
- Le message précise le lieu et les horaires de retrait
- Un échec d'envoi ne bloque pas le changement de statut

### 10. Sondages et votes

Consultations du bureau. L'anonymat et l'unicité du vote sont les points délicats.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les sondages et leurs options | 5 | High | MVP |
| Lister les sondages | 3 | High | MVP |
| Enregistrer un vote | 5 | Highest | MVP |
| Empêcher le double vote, anonymat inclus | 5 | Highest | MVP |
| Fiabiliser les compteurs de votes | 5 | High | MVP |
| Appliquer la visibilité des résultats | 5 | High | MVP |
| Restreindre aux étudiants du campus | 3 | High | MVP |
| Clôturer automatiquement à la date limite | 3 | Medium | V1 |

**Gérer les sondages et leurs options**

Création avec options en cascade, modification, clôture.

- Réservé au rôle ADMIN
- Au moins deux options sont exigées
- Un sondage ayant déjà reçu des votes n'est plus modifiable

**Lister les sondages**

Sondages accessibles à l'utilisateur, selon son profil.

- Les BROUILLON ne sont visibles que des administrateurs
- Indique si l'utilisateur a déjà voté
- Respecte la restriction campus

**Enregistrer un vote**

Voter, en choix unique ou en choix multiple.

- CHOIX_UNIQUE n'accepte qu'une seule option
- CHOIX_MULTIPLE accepte plusieurs options du même sondage
- Le vote est refusé après la date limite
- Un sondage qui n'est pas ACTIF n'accepte aucun vote

**Empêcher le double vote, anonymat inclus**

L'index unique (sondage, user) ne protège pas les sondages anonymes, dont `user` est nul. Le contrôle doit alors être applicatif, sans casser l'anonymat.

- Le double vote est impossible sur un sondage nominatif
- Le double vote est empêché sur un sondage anonyme sans stocker le lien entre le vote et son auteur
- Le mécanisme retenu est documenté
- Les deux cas sont couverts par des tests

**Fiabiliser les compteurs de votes**

`Sondage.totalVotes` et `OptionSondage.votes` sont dénormalisés pour éviter les agrégations. Ils peuvent donc s'écarter du réel.

- Les compteurs sont mis à jour dans la transaction du vote
- La somme des votes par option reste cohérente avec le total
- Une commande de recalcul existe
- Un test concurrent valide la cohérence

**Appliquer la visibilité des résultats**

TOUJOURS, APRES_VOTE et APRES_DEADLINE doivent réellement conditionner l'accès aux résultats.

- Chaque mode est respecté côté serveur
- Les résultats masqués ne transitent pas dans la réponse
- Un administrateur voit toujours les résultats
- Les trois modes sont testés

**Restreindre aux étudiants du campus**

`campusUniquement` vaut vrai par défaut et doit filtrer l'accès.

- Un VISITOR ne peut ni consulter ni voter un sondage réservé au campus
- Le filtrage s'applique aussi aux listes
- La règle est couverte par des tests

**Clôturer automatiquement à la date limite**

Passer les sondages en CLOS sans intervention manuelle.

- Tâche planifiée clôturant les sondages arrivés à échéance
- La clôture rend les résultats visibles si le mode le prévoit
- L'opération est idempotente

### 11. Articles et actualités

Publication éditoriale du bureau, avec slugs et publication programmée.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les articles | 5 | High | MVP |
| Générer un slug unique | 3 | High | MVP |
| Lister publiquement les articles | 3 | High | MVP |
| Consulter un article par son slug | 2 | High | MVP |
| Programmer une publication | 5 | Medium | V1 |
| Rattacher un article à un événement | 2 | Low | V1 |

**Gérer les articles**

Rédaction, modification et archivage.

- Réservé au rôle ADMIN
- Le contenu enrichi est assaini avant stockage
- L'auteur est rattaché au compte rédacteur

**Générer un slug unique**

`slug` porte un index unique et sert d'URL publique.

- Le slug est dérivé du titre, sans accent ni caractère spécial
- Les collisions sont résolues par un suffixe
- Modifier le titre ne casse pas l'URL d'un article déjà publié

**Lister publiquement les articles**

Liste paginée, filtrable par catégorie.

- Seuls les articles PUBLIE sont visibles publiquement
- Tri par date de publication décroissante
- L'extrait est renvoyé, pas le contenu complet

**Consulter un article par son slug**

Accès public par URL lisible.

- La recherche se fait par slug, pas par identifiant
- Un BROUILLON n'est accessible qu'à un administrateur
- Inclut l'auteur et l'événement rattaché

**Programmer une publication**

`publishedAt` doit permettre de programmer une parution.

- Un article dont la date est future reste invisible jusqu'à l'échéance
- Une tâche planifiée effectue la publication
- La date de publication est modifiable avant l'échéance

**Rattacher un article à un événement**

Annonce ou compte rendu lié à un événement.

- Le rattachement à un événement est optionnel
- La fiche événement liste les articles associés
- Supprimer l'événement laisse l'article en place, sans rattachement

### 12. Annuaire des finissants

Vitrine des profils, consultable par les sponsors accrédités. C'est la zone la plus sensible : données personnelles et CV.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer son profil de finissant | 5 | High | MVP |
| Contrôler sa visibilité | 3 | High | MVP |
| Réserver l'annuaire aux sponsors accrédités | 5 | Highest | MVP |
| Rechercher dans l'annuaire | 5 | High | MVP |
| Télécharger un CV en décomptant le quota | 5 | Highest | MVP |
| Déposer son CV et sa photo | 3 | High | MVP |

**Gérer son profil de finissant**

Création et mise à jour de la fiche par l'étudiant.

- Réservé aux comptes dont `isFinissant` vaut vrai
- Les URL externes sont validées
- Les compétences sont normalisées

**Contrôler sa visibilité**

`isVisible` doit rester sous le contrôle exclusif de l'étudiant.

- L'étudiant peut se retirer de l'annuaire à tout moment
- Un profil masqué n'apparaît dans aucune recherche de sponsor
- Un administrateur ne peut pas forcer la visibilité

**Réserver l'annuaire aux sponsors accrédités**

L'accès dépend de `accesAnnuaire` sur le palier. Une erreur ici expose des données personnelles à des tiers non autorisés.

- Seuls les sponsors dont le palier autorise l'annuaire y accèdent
- Un sponsor sans palier est refusé
- Les administrateurs conservent l'accès
- Tous les cas de refus sont couverts par des tests

**Rechercher dans l'annuaire**

Recherche par filière, par promotion et par compétences.

- Filtres sur la filière, la promotion et les compétences
- Seuls les profils visibles sont renvoyés
- Chaque consultation incrémente le compteur du sponsor
- Pagination appliquée

**Télécharger un CV en décomptant le quota**

Le téléchargement doit consommer le quota `maxTelechargementsCv` et être servi par une URL à durée limitée.

- Le téléchargement est refusé lorsque le quota est épuisé
- Le compteur `cvTelecharges` est incrémenté de façon fiable
- Le CV est servi par une URL signée qui expire, jamais par une URL publique
- Chaque téléchargement est tracé

**Déposer son CV et sa photo**

Envoi des pièces du profil vers R2.

- Les types et tailles de fichiers sont validés
- Le CV n'est jamais accessible publiquement
- Remplacer un fichier supprime le précédent

### 13. Sponsors et accréditations

Paliers, quotas et espace sponsor. Les quotas sont la contrepartie commerciale de l'accès à l'annuaire.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Gérer les paliers d'accréditation | 3 | High | MVP |
| Gérer les sponsors | 5 | High | MVP |
| Résoudre les quotas effectifs | 5 | Highest | MVP |
| Bloquer au dépassement de quota | 5 | Highest | MVP |
| Réinitialiser les compteurs par période | 5 | High | V1 |
| Publier la page des sponsors | 3 | Medium | MVP |
| Ouvrir l'espace sponsor | 5 | Medium | V1 |
| Réserver les statistiques détaillées selon le palier | 3 | Low | V2 |
| Inviter un sponsor | 5 | Medium | V1 |

**Gérer les paliers d'accréditation**

Les paliers sont configurables par le bureau : accès à l'annuaire, quotas, taille de logo, mise en avant.

- Réservé au rôle ADMIN
- `ordre` détermine l'affichage et le prestige
- Un palier utilisé par un sponsor ne peut pas être supprimé sans réaffectation

**Gérer les sponsors**

Gestion des entreprises partenaires et de leur rattachement à un palier.

- Réservé au rôle ADMIN
- Rattachement optionnel à un compte utilisateur de rôle SPONSOR
- L'email est obligatoire et validé

**Résoudre les quotas effectifs**

`quotasPersonnalises` est prioritaire sur les valeurs du palier lorsqu'il est défini. Cette règle doit être centralisée, et non dispersée dans les appelants.

- Une valeur personnalisée prime sur celle du palier
- Une valeur absente retombe sur celle du palier
- Un sponsor sans palier ni quota n'a aucun droit
- La résolution est couverte par des tests, cas partiels inclus

**Bloquer au dépassement de quota**

Faire respecter `maxConsultationsProfils` et `maxTelechargementsCv`.

- Le dépassement renvoie une erreur métier explicite
- Les compteurs de `stats` sont fiables sous accès concurrents
- Le sponsor voit sa consommation restante

**Réinitialiser les compteurs par période**

`StatistiquesSponsor` est décrit comme remis à zéro à chaque période de facturation, alors qu'aucune période n'est modélisée en base.

- La période de facturation est modélisée
- La remise à zéro est automatique et idempotente
- L'historique des périodes écoulées est conservé

**Publier la page des sponsors**

Vitrine respectant l'ordre des paliers, la taille de logo et la mise en avant.

- Tri par `ordre` de palier
- `tailleLogo` et `isFeatured` sont exposés au frontend
- Chaque vue incrémente `vuesPage`

**Ouvrir l'espace sponsor**

Le sponsor consulte sa consommation et ses statistiques.

- Un sponsor ne voit que ses propres statistiques
- Affiche les quotas consommés et restants
- Réservé au rôle SPONSOR

**Réserver les statistiques détaillées selon le palier**

`statsDetaillees` conditionne l'accès à une vue enrichie.

- Les statistiques enrichies sont réservées aux paliers concernés
- Les autres paliers reçoivent la vue simple
- La règle est couverte par des tests

**Inviter un sponsor**

Créer le compte d'un sponsor et lui transmettre ses accès sans mot de passe en clair.

- Invitation par email, avec un lien d'activation qui expire
- Le sponsor définit lui-même son mot de passe
- Le compte est créé avec le rôle SPONSOR et rattaché à la fiche

### 14. Notifications et rappels

Notifications in-app, rappels programmés et déclencheurs métier.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Émettre des notifications in-app | 5 | High | MVP |
| Consulter et marquer ses notifications | 3 | High | MVP |
| Programmer un rappel | 5 | Medium | V1 |
| Envoyer les rappels programmés | 5 | Medium | V1 |
| Acheminer les rappels par email | 3 | Medium | V1 |
| Implémenter les notifications push | 8 | Low | V2 |
| Gérer les préférences de notification | 5 | Low | V2 |
| Brancher les déclencheurs métier | 5 | High | MVP |

**Émettre des notifications in-app**

Service de création de notifications, appelé par les autres modules.

- Création unitaire et diffusion groupée
- Les types suivent l'énumération `TypeNotification`
- `lien` pointe vers la ressource concernée

**Consulter et marquer ses notifications**

Liste paginée, marquage lu et non lu.

- Un utilisateur ne voit que ses propres notifications
- Marquage unitaire et marquage global
- Le nombre de notifications non lues est exposé

**Programmer un rappel**

L'utilisateur choisit sa date et ses canaux avant un événement.

- La date doit être future et antérieure à l'événement
- Les canaux PUSH et EMAIL sont sélectionnables
- Un rappel est modifiable et supprimable

**Envoyer les rappels programmés**

Tâche planifiée traitant les rappels échus, avec `isSent` comme garde-fou.

- Un rappel n'est jamais envoyé deux fois
- Un échec est réessayé sans créer de doublon
- L'annulation de l'événement annule les rappels associés

**Acheminer les rappels par email**

Envoi des rappels via `MailService`.

- Un template dédié existe
- Un échec est journalisé sans interrompre les autres envois
- Le contenu rappelle la date, le lieu et le billet

**Implémenter les notifications push**

Le canal PUSH est prévu dans l'énumération mais n'a aucune implémentation.

- Enregistrement et révocation des abonnements navigateur
- L'envoi Web Push fonctionne
- Dégradation propre si l'abonnement a expiré

**Gérer les préférences de notification**

Permettre à l'utilisateur de choisir ce qu'il reçoit.

- Préférences par type et par canal
- Les préférences sont respectées à l'émission
- Les notifications critiques restent non désactivables

**Brancher les déclencheurs métier**

Relier les événements métier aux notifications : paiement confirmé, billet émis, commande prête, sondage ouvert, article publié.

- Chaque déclencheur est branché et testé
- Un échec de notification n'interrompt jamais l'action métier
- Aucun doublon en cas de rejeu

### 15. Fichiers et médias

Stockage Cloudflare R2. La distinction entre public et privé y est structurante, les CV ne devant jamais être publics.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Envoyer un fichier vers R2 | 5 | High | MVP |
| Servir les fichiers privés par URL signée | 5 | Highest | MVP |
| Supprimer les fichiers et purger les orphelins | 3 | Medium | V1 |
| Traiter les images | 5 | Low | V2 |

**Envoyer un fichier vers R2**

Compléter `file.service.ts` avec la validation et l'envoi.

- Les types MIME et la taille sont validés côté serveur
- Les noms de fichiers sont assainis, aucune traversée de chemin n'est possible
- Les erreurs de stockage sont explicites

**Servir les fichiers privés par URL signée**

Les CV et les factures ne doivent pas être accessibles par une URL devinable.

- Les objets privés ne sont pas lisibles publiquement
- Les URL signées expirent, avec une durée configurable
- La génération d'URL vérifie les droits de l'appelant
- Des tests couvrent la tentative d'accès non autorisé

**Supprimer les fichiers et purger les orphelins**

Un profil ou un produit modifié laisse derrière lui des fichiers non référencés.

- Supprimer une entité supprime ses fichiers
- Une tâche identifie et purge les orphelins
- La purge est journalisée et réversible pendant une période de grâce

**Traiter les images**

Réduire le poids des images de galerie et de catalogue.

- Redimensionnement et conversion en WebP
- Génération de vignettes
- Traitement asynchrone, sans bloquer l'envoi

### 16. Tableau de bord administrateur

Pilotage du bureau : journal d'activité et indicateurs.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Alimenter le journal d'activité | 5 | High | MVP |
| Exposer le flux d'activité | 3 | Medium | V1 |
| Calculer les indicateurs clés | 5 | High | MVP |
| Ventiler les revenus | 5 | Medium | V1 |
| Exporter les transactions | 3 | Low | V2 |
| Définir la conservation du journal d'activité | 3 | Low | V2 |

**Alimenter le journal d'activité**

`JournalActivite` est prévu pour alimenter le flux en direct du tableau de bord, mais rien ne l'écrit aujourd'hui.

- Les événements métier écrivent dans le journal, selon `TypeActivite`
- L'écriture ne fait jamais échouer l'action métier
- `metadata` porte le contexte utile, en jsonb

**Exposer le flux d'activité**

Rendre le journal consultable depuis le tableau de bord.

- Liste paginée, filtrable par type et par période
- Réservé au rôle ADMIN
- Tri chronologique inverse

**Calculer les indicateurs clés**

Chiffres de synthèse : revenus, inscriptions, utilisateurs, commandes.

- Les indicateurs portent sur la génération active
- Comparaison avec la période précédente
- Requêtes indexées, temps de réponse maîtrisé

**Ventiler les revenus**

Répartition par origine, par méthode de paiement et par période.

- Ventilation entre billetterie et boutique
- Ventilation entre Orange Money et MTN MoMo
- Série temporelle exploitable par le frontend

**Exporter les transactions**

Export destiné à la trésorerie du bureau.

- Export CSV sur une période donnée
- Montants en FCFA, sans décimale
- L'export est journalisé

**Définir la conservation du journal d'activité**

Le journal croît indéfiniment et finira par peser sur les performances.

- La durée de conservation est définie et configurable
- Purge ou archivage automatique au-delà
- Les entrées à valeur comptable sont préservées

### 17. Qualité, sécurité et observabilité

Ce qui rend le backend livrable : documentation, tests, supervision et durcissement.

| Récit | Pts | Priorité | Phase |
|---|---|---|---|
| Documenter l'API dans OpenAPI | 5 | High | MVP |
| Couvrir les services critiques par des tests unitaires | 8 | High | MVP |
| Écrire les scénarios BDD des parcours critiques | 8 | High | MVP |
| Tester les endpoints de bout en bout | 5 | High | MVP |
| Brancher Sentry | 3 | Medium | V1 |
| Structurer les journaux et les corréler | 5 | Medium | V1 |
| Enrichir le healthcheck | 3 | Medium | V1 |
| Durcir la configuration HTTP | 3 | High | MVP |
| Automatiser le déploiement | 5 | Medium | V1 |

**Documenter l'API dans OpenAPI**

Swagger est installé. Chaque endpoint doit être décrit pour que le frontend puisse s'y appuyer.

- Tous les endpoints sont annotés, avec leurs schémas de requête et de réponse
- Les codes d'erreur sont documentés
- L'authentification est déclarée dans la spécification
- La spécification est publiée par la CI

**Couvrir les services critiques par des tests unitaires**

Priorité aux règles dont une erreur coûte de l'argent ou expose des données : tarification, quotas, paiement, capacité.

- Couverture d'au moins 80 % sur les services critiques
- Le seuil est vérifié par la CI
- Les cas limites et les erreurs sont testés, pas seulement le chemin nominal

**Écrire les scénarios BDD des parcours critiques**

Cucumber est configuré. Les parcours à couvrir : inscription à un événement payant, paiement, scan du billet, commande en boutique, vote.

- Un scénario par parcours critique
- Les scénarios s'exécutent en CI sur une base dédiée
- Les cas d'échec sont couverts, pas seulement les cas favorables

**Tester les endpoints de bout en bout**

Tests end-to-end sur les endpoints publics et sur les règles d'accès.

- Les endpoints publics répondent sans authentification
- Les endpoints protégés refusent un appel non authentifié
- Le cloisonnement par rôle est vérifié

**Brancher Sentry**

Capture des erreurs en staging et en production.

- Les erreurs non gérées sont remontées avec leur contexte
- Aucune donnée personnelle ni secret ne figure dans les rapports
- Les versions sont tracées, pour relier une erreur à un déploiement

**Structurer les journaux et les corréler**

Pouvoir suivre une requête de bout en bout, notamment sur les parcours de paiement.

- Journaux structurés en JSON
- Identifiant de corrélation propagé sur toute la requête
- Aucun secret ni mot de passe n'est journalisé

**Enrichir le healthcheck**

Le healthcheck actuel ne vérifie aucune dépendance.

- Vérifie la base de données, R2 et le SMTP
- Distingue la vivacité de la disponibilité
- Renvoie un code HTTP exploitable par l'hébergeur

**Durcir la configuration HTTP**

helmet et la limitation de débit sont installés, mais leur réglage n'est pas arbitré.

- CORS restreint aux origines du frontend, par environnement
- Limitation de débit globale active, avec des exceptions documentées
- Les en-têtes de sécurité sont vérifiés par un test

**Automatiser le déploiement**

La CI valide sept contrôles mais ne déploie rien.

- Déploiement automatique de `staging` après validation
- Déploiement en production sur validation manuelle
- Les migrations sont jouées avant le basculement
- La procédure de retour arrière est documentée

