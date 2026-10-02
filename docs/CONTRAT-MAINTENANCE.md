# Contrat de maintenance COCFET — cadrage, évaluation et facturation

> Document de travail pour préparer la discussion avec le client. Les montants
> sont des **hypothèses paramétrées** (§6), à remplacer par vos taux réels.
> L'inventaire (§1) est tiré du dépôt backend ; le frontend
> (`SOURCING-FRONTEND`) n'a pas été analysé et doit être ajouté au périmètre.

## 1. Ce qu'il faut maintenir (inventaire réel)

| Domaine | Contenu constaté dans le dépôt | Charge de maintenance induite |
|---|---|---|
| Application | NestJS 11 / TypeScript, ~26 000 lignes, 20 modules métier (auth, événements, billetterie QR, boutique, commandes, paiement, sondages, annuaire, sponsors, notifications, cotisations, justificatifs, documents…) | Correctifs, évolutions mineures, support fonctionnel |
| Dépendances | pnpm, Dependabot hebdomadaire (majeures exclues), audit `high` en CI | Revue/merge des MAJ, montées de version majeures (Node, NestJS, TypeORM) à part |
| Base de données | PostgreSQL 15, 21 migrations, schéma géré uniquement par migrations | Migrations de chaque évolution, montée de version PG, performance |
| Infra | VPS unique : Caddy, recette + production isolées (Docker), certificats Postgres, Let's Encrypt ; dev sur Railway | Patchs OS, Docker, renouvellements, surveillance disque/mémoire, déploiements |
| Sauvegardes | Script quotidien, rétention sur VPS, copie R2 ; restauration à tester | Vérification, **test de restauration périodique**, incident de restauration |
| Tâches planifiées | Rappels, réconciliation des paiements, purges (comptes, justificatifs, traces de scan), notifications | Surveillance, correction en cas de dérive |
| Services tiers | **Fapshi** (Mobile Money), **Brevo** (emails), **Cloudflare R2**, **Upstash**, **Sentry**, SonarCloud, GitHub Actions, nom de domaine/DNS, SSO UCAC-ICAM (prévu) | Rotation des secrets, évolutions d'API tierces, abonnements (voir §5) |
| Sécurité / données perso | SECURITY.md, Semgrep, CodeQL, rate limiting, données d'étudiants exposées à des sponsors | Veille CVE, correctifs sécurité, conformité (consentements, purge, demandes de suppression) |
| Qualité / CI | Jest, e2e, Cucumber, SonarCloud, branches `develop → staging → main` | Garder la CI verte, maintenir les tests |

## 2. Les quatre types de maintenance à distinguer

1. **Corrective** — corriger un défaut de la version livrée. Garantie de bon fonctionnement la plus courante.
2. **Préventive / sécuritaire** — MAJ de dépendances, correctifs de failles, patchs système, rotation des secrets, tests de restauration.
3. **Opérationnelle (run)** — hébergement, supervision, sauvegardes, déploiements, astreinte, support utilisateurs.
4. **Évolutive** — nouvelles fonctionnalités, nouvelles intégrations, changement de règle métier. **À ne pas inclure dans le forfait** : facturée au devis ou via un volume d'heures.

La confusion entre ces quatre catégories est la première cause de conflit
client. Le contrat doit dire explicitement dans laquelle tombe chaque demande.

## 3. Formules proposées

| | Essentiel | Standard (recommandée) | Premium |
|---|---|---|---|
| Correctif bloquant (prod indisponible, paiement/billetterie HS) | prise en charge < 8 h ouvrées | < 4 h ouvrées | < 1 h, 7j/7 en période d'événement |
| Anomalie majeure | < 2 jours ouvrés | < 1 jour ouvré | < 4 h |
| Anomalie mineure | prochain lot | sous 5 jours | sous 3 jours |
| MAJ sécurité des dépendances | trimestrielle | mensuelle + urgentes sous 72 h | continue, urgentes sous 24 h |
| Supervision (Sentry, sonde de santé) | alertes seules | revue hebdomadaire | revue quotidienne |
| Test de restauration | annuel | trimestriel | mensuel |
| Rapport d'activité | semestriel | mensuel | mensuel + revue trimestrielle |
| Heures d'évolution mineure incluses | 0 | 4 h / mois | 10 h / mois |
| Support utilisateurs (admins du bureau) | email | email + messagerie | + téléphone en événement |

À fixer aussi : horaires du support (ex. 8 h–18 h, lun–ven, fuseau Douala), canal
unique de demande (tickets Jira `KAN-*` déjà en usage), et définition écrite des
niveaux de gravité (bloquant / majeur / mineur).

**Spécificité du projet :** l'activité est **saisonnière** (billetterie, ventes,
remise des diplômes). Prévoir des **périodes sensibles** déclarées à l'avance
(ex. 3 semaines avant chaque grand événement) avec gel des déploiements et
disponibilité renforcée, plutôt qu'un Premium permanent.

## 4. Ce que le contrat doit trancher (clauses clés)

- **Périmètre exact** : backend, frontend, infra VPS, Railway (dev), domaines, tiers. Liste fermée.
- **Exclusions** : évolutions fonctionnelles, panne d'un tiers (Fapshi, Brevo, opérateurs Mobile Money, hébergeur), mauvaise utilisation, modifications faites par un tiers sans accord, données saisies erronées, formation initiale, montées de version **majeure** (Node, NestJS, PostgreSQL, TypeORM).
- **Indisponibilité** : engagement de **moyens** (délai de prise en charge) plutôt que de disponibilité chiffrée. Une VPS unique ne permet pas honnêtement de promettre 99,9 %. Si le client veut un taux, il faut chiffrer la redondance (§5).
- **RPO / RTO** : perte de données maximale tolérée (aujourd'hui sauvegarde quotidienne, soit jusqu'à 24 h) et délai de remise en service visé. Un RPO plus court (réplication, WAL) est un surcoût.
- **Propriété et accès** : qui détient les comptes (GitHub, VPS, R2, Brevo, Fapshi, domaine, Sentry). Idéalement **au nom du client**, avec accès délégué au prestataire. Évite la prise en otage et simplifie la fin de contrat.
- **Données personnelles** : rôle du prestataire (sous-traitant), responsabilité du client (responsable de traitement), confidentialité, notification d'incident, durée de conservation, suppression en fin de contrat. Vérifier le cadre camerounais applicable (loi n° 2024/017 sur la protection des données personnelles).
- **Sécurité** : engagement de correction des failles critiques, divulgation d'incident, secrets jamais partagés par canal non sécurisé.
- **Plafond de responsabilité** : généralement limité au montant annuel du contrat.
- **Durée et reconduction** : 12 mois, tacite reconduction, préavis 2–3 mois, **révision annuelle du prix** (indice ou % fixé).
- **Réversibilité** : à la sortie, livraison du code, des migrations, des sauvegardes et de la documentation (déjà largement dans `docs/`), avec une prestation de transfert chiffrée.
- **Transition de génération** : le bureau change chaque année. Désigner un **référent client** stable (ou une personne de l'école) et prévoir un point de passation annuel. Sans cela, l'interlocuteur disparaît à chaque promotion.
- **Pénalités / crédits** : si le client en demande, les limiter à un crédit sur la redevance et jamais en dommages illimités.
- **Facturation du hors-forfait** : taux horaire/journalier, majoration urgence/week-end, seuil d'accord préalable écrit.

## 5. Coûts à ne pas oublier (hors main-d'œuvre)

À identifier **un par un** avec le client : qui paie, et est-ce refacturé avec ou sans marge ?

| Poste | Fréquence | Remarque |
|---|---|---|
| VPS (4–8 Go, 2–4 vCPU, 40–80 Go) | mensuel | Un seul serveur pour recette **et** production : point de défaillance unique |
| Domaine `cocfet.com` + DNS | annuel | |
| Cloudflare R2 (fichiers + sauvegardes) | mensuel, à l'usage | Croît avec les justificatifs/médias |
| Brevo (emails) | mensuel selon volume | Domaine d'envoi vérifié obligatoire |
| Upstash Redis | gratuit → payant selon volume | |
| Sentry, SonarCloud | gratuit / payant selon plan | SonarCloud gratuit si dépôt public |
| Railway (dev) | mensuel | À arrêter si inutile |
| Frais Fapshi / opérateurs | par transaction | Pris sur les ventes, pas sur le contrat |
| Certificats | gratuits (Let's Encrypt) | |

Surcoûts optionnels : serveur de secours ou seconde VPS, réplication de base
managée, supervision externe (UptimeRobot, Better Stack), audit de sécurité
annuel, test de charge avant les grands événements.

## 6. Méthode d'évaluation et de facturation

### 6.1 Évaluer l'effort récurrent (heures par mois)

| Activité | Hypothèse Essentiel | Standard | Premium |
|---|---|---|---|
| Revue/merge MAJ dépendances + vérif. CI | 1 h | 3 h | 5 h |
| Patchs OS/Docker, certificats, disque | 1 h | 2 h | 3 h |
| Supervision, lecture Sentry, logs | 0,5 h | 2 h | 6 h |
| Test de restauration (lissé) | 0,25 h | 0,75 h | 2 h |
| Support, tickets, petits correctifs | 2 h | 5 h | 10 h |
| Reporting, pilotage, réunion | 0,5 h | 2 h | 3 h |
| Évolutions mineures incluses | 0 | 4 h | 10 h |
| **Total heures / mois** | **≈ 5 h** | **≈ 19 h** | **≈ 39 h** |

Ce sont des hypothèses de départ : **mesurez-les** sur 2–3 mois (Jira, journal
de temps) avant de figer le prix, ou signez une première période d'essai.

### 6.2 Formule de prix

```
Redevance mensuelle = (H_mois × Taux_horaire)
                    + Coûts tiers refacturés (§5) × (1 + marge)
                    + Prime de risque / disponibilité
```

- `Taux_horaire` : taux interne chargé (salaire + charges + marge), en FCFA.
- `Prime de risque` : 10–20 % sur Standard/Premium pour l'astreinte et la responsabilité.
- **Heures d'évolution** : à vendre en **banque d'heures** prépayée (ex. packs de 10 h), non reportables ou reportables 3 mois, plutôt que de les noyer dans le forfait.
- **Hors forfait / urgence** : taux × 1,5 (soir, week-end, hors période convenue).

### 6.3 Exemple chiffré (illustratif, taux fictif de 25 000 FCFA/h)

| | Essentiel | Standard | Premium |
|---|---|---|---|
| Main-d'œuvre (H × 25 000) | 125 000 | 475 000 | 975 000 |
| Tiers refacturés (estimation) | 40 000 | 60 000 | 100 000 |
| Prime de risque (10 % / 15 %) | — | 80 000 | 160 000 |
| **Redevance mensuelle** | **≈ 165 000** | **≈ 615 000** | **≈ 1 235 000** |
| Annuel | ≈ 1,98 M | ≈ 7,4 M | ≈ 14,8 M |

Ces chiffres sont **sans valeur contractuelle** : ils montrent la mécanique.
Pour un projet associatif/étudiant, le budget client est probablement bien
inférieur, d'où l'intérêt de la formule Essentiel et d'un module « périodes
sensibles » à la carte (§3).

### 6.4 Modalités de facturation

- **Forfait** facturé **trimestriellement ou annuellement d'avance** (meilleure trésorerie, moins de relances) ; mensuel seulement si le client l'exige.
- **Banque d'heures** facturée à l'achat.
- **Hors forfait** facturé en fin de mois sur relevé d'heures validé.
- **Frais tiers** : soit refacturés au coût réel avec justificatifs, soit intégrés au forfait avec un plafond d'usage (au-delà, avenant). Choisir un seul régime.
- **Délai de paiement** et pénalités de retard, **suspension du service** (hors sécurité et sauvegardes) en cas d'impayé.
- **Indexation annuelle** du taux horaire.

## 7. Risques propres à ce projet à traiter avant de signer

1. **VPS unique** pour recette et production : une panne matérielle coupe tout. Le chiffrer comme option ou le faire accepter par écrit.
2. **Sauvegarde quotidienne** : RPO de 24 h, inacceptable pour un événement avec billetterie ouverte. Proposer une sauvegarde renforcée en périodes sensibles.
3. **Dépendance à Fapshi** : l'essentiel des revenus passe par leur API. Prévoir la procédure en cas de changement d'API ou de panne, et la réconciliation manuelle (un service de réconciliation existe déjà).
4. **Connaissance concentrée** : documenter et prévoir un remplaçant pour la continuité du service.
5. **Données d'étudiants** (annuaire, justificatifs, CV) : le risque réglementaire et d'image est plus élevé que le risque technique ; ne pas minimiser la clause §4.
6. **Écart de dette technique** : lancer le contrat avec un état des lieux écrit (couverture de tests, vulnérabilités ouvertes, Sonar), pour ne pas hériter d'une dette que le client croirait garantie.
7. **Changement annuel de bureau** : référent stable et passation (§4).

## 8. Questions à poser au client

1. Périmètre : backend seul ou backend + frontend + infra ? Qui possède les comptes tiers ?
2. Quelle tolérance à l'indisponibilité, et à quelles périodes de l'année est-elle critique (dates d'événements) ?
3. Quel budget annuel maximal, et qui signe (association, école, partenaire) ? Facture en FCFA, TVA, retenue à la source ?
4. Combien d'utilisateurs administrateurs, et quel niveau de support leur est nécessaire (formation, hotline) ?
5. Quel volume de trafic et de transactions attendu par saison ?
6. Quelles évolutions sont déjà prévues (SSO UCAC-ICAM, nouvelles générations) : à inclure en banque d'heures ou en projet séparé ?
7. Qui est le référent côté client et comment la passation annuelle est-elle assurée ?
8. Durée d'engagement souhaitée et conditions de sortie ?

## 9. Prochaines étapes suggérées

1. Valider avec vous les formules (§3) et vos taux réels (§6) ; je mets à jour le calcul.
2. Étendre l'inventaire au frontend et à la comptabilité réelle des abonnements tiers.
3. Faire un état des lieux technique de départ (§7.6) : vulnérabilités ouvertes, couverture de tests, dette.
4. Rédiger le contrat type (annexes : périmètre, SLA, gravité, tarifs, RGPD/données) à faire relire par un juriste.
5. Proposer une période d'essai de 3 mois avec relevé d'heures pour caler le prix.
