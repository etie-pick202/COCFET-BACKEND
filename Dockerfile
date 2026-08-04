# Image de production, indépendante de l'hébergeur.
#
# Render, Railway, Fly.io, Scaleway ou un VPS : tous savent construire un
# Dockerfile. Le choix se ramène donc à fournir des variables d'environnement,
# et rien dans le code n'a à changer le jour où il sera fait.

# ---------- Étape 1 : dépendances et compilation ----------
FROM node:22-alpine AS build

# corepack fixe la version de pnpm depuis package.json : la CI, les postes de
# l'équipe et l'image utilisent ainsi exactement le même résolveur.
RUN corepack enable

WORKDIR /app

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation et la construction reste rapide.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Retire les dépendances de développement de node_modules avant la copie.
RUN pnpm prune --prod

# ---------- Étape 2 : image d'exécution ----------
FROM node:22-alpine AS runtime

# tini fournit un vrai PID 1 : sans lui, le SIGTERM du redéploiement n'atteint
# pas Node, et l'hébergeur finit par tuer le conteneur en pleine requête.
RUN apk add --no-cache tini

ENV NODE_ENV=production

WORKDIR /app

# L'utilisateur `node` existe déjà dans l'image officielle. Exécuter en root
# donnerait à une éventuelle exécution de code distant les pleins pouvoirs sur
# le conteneur.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package.json ./package.json

USER node

EXPOSE 3000

# Le port est fourni par l'hébergeur ; 3000 n'est qu'un repli.
ENV PORT=3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
