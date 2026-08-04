# Socle technique

Ce que tout module métier peut supposer présent. L'objectif de ces briques est
qu'aucun développeur ne soit bloqué par un compte prestataire non ouvert.

## Pagination

Toute route qui renvoie une liste accepte `PaginationDto` et répond un
`ResultatPagine<T>`.

```ts
@Get()
async lister(@Query() pagination: PaginationDto): Promise<ResultatPagine<Evenement>> {
  const tri = triAutorise(pagination.tri, ['createdAt', 'dateDebut'], 'dateDebut');

  return paginer(
    await this.evenements.findAndCount({
      order: { [tri]: pagination.ordre },
      skip: pagination.sauter,
      take: pagination.limite,
    }),
    pagination,
  );
}
```

`limite` est plafonnée à 100. **`triAutorise` n'est pas facultatif** : la valeur
de `tri` finit dans une clause `ORDER BY`, que TypeORM n'échappe pas. Le DTO
n'en contrôle que la forme ; c'est la liste blanche de chaque appelant qui ferme
réellement la porte.

Réponse :

```json
{
  "donnees": [],
  "meta": { "page": 1, "limite": 20, "total": 0, "totalPages": 0, "aSuivante": false, "aPrecedente": false }
}
```

## Ports et adaptateurs

Trois dépendances externes ne sont pas encore disponibles. Chacune est décrite
par une interface, injectée par un jeton, et servie aujourd'hui par un
adaptateur de développement. L'adaptateur réel se substituera dans le module,
sans toucher aux appelants.

| Port | Jeton | Adaptateur actuel | Adaptateur cible |
| --- | --- | --- | --- |
| `PasserellePaiement` | `PASSERELLE_PAIEMENT` | `PasserellePaiementFactice` | NotchPay |
| `CanalNotification` | `CANAL_NOTIFICATION` | `CanalNotificationJournal` | Push mobile |
| `Stockage` | `STOCKAGE` | `StockageLocal` ou `StockageR2` | Cloudflare R2 |

```ts
constructor(
  @Inject(PASSERELLE_PAIEMENT) private readonly paiement: PasserellePaiement,
) {}
```

Ces doubles **ne sont pas complaisants**, et c'est délibéré : un double qui
accepte tout laisse écrire du code qui ne fonctionne qu'avec lui, et le passage
en production découvre les cas d'erreur en même temps que les premiers vrais
paiements. La passerelle factice refuse donc un webhook mal signé, refuse un
montant décimal, et renvoie l'intention existante quand une référence est
rejouée.

Elle rend aussi les échecs reproductibles, par le dernier chiffre du numéro :

| Numéro se terminant par | Issue |
| --- | --- |
| `0` | `ECHOUE` |
| `1` | `EN_ATTENTE` (webhook jamais reçu) |
| autre | `COMPLETE` |

Le stockage bascule tout seul : si les quatre variables `R2_*` sont
renseignées, c'est R2 ; sinon le disque, sous `STOCKAGE_LOCAL_DIR`. Dans les
deux cas l'accès passe par une URL signée expirante — jamais par un chemin
public permanent. En production, l'absence des variables `R2_*` empêche le
démarrage : le disque local ne survit pas à un redéploiement.

L'email ne figure pas dans ce tableau : il n'est bloqué par rien. `MailService`
parle SMTP, servi par Mailpit en local (`docker compose up -d`, boîte sur
<http://localhost:8025>) et par Brevo ailleurs. Les mêmes variables `MAIL_*`
couvrent les deux, un port n'y ajouterait qu'une indirection.

## Tests : obtenir un vrai JWT

`test/utils/authentification.ts` crée un compte en base et signe un jeton avec
le `JwtService` de l'application. Le jeton traverse ensuite la vraie
`JwtStrategy` et les vraies gardes.

```ts
const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });

await request(app.getHttpServer())
  .post('/api/v1/evenements')
  .set(admin.entetes)
  .send({ ... })
  .expect(201);
```

**Ne remplacez pas `JwtAuthGuard` ou `RolesGuard` par des doubles.** Des tests
qui contournent les gardes passent sans jamais exercer l'autorisation, c'est-à-
dire sans vérifier ce qu'ils prétendent vérifier. La stratégie relit
l'utilisateur en base à chaque requête : un compte désactivé ou supprimé perd
l'accès immédiatement, et un rôle revendiqué dans la charge utile est écrasé
par le rôle réel.

Pour les cas de refus : `jetonExpire()` (signature valide, échéance passée) et
`jetonSigneAilleurs()` (jeton forgé avec un autre secret).

`purgerUtilisateurs(app)` vide la table `users` entre les suites. Les tests e2e
partagent une base et tournent en un seul worker (`maxWorkers: 1`) : chaque
fichier monte l'application, qui joue les migrations au démarrage.
