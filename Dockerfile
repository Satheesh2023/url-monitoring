FROM node:20-bookworm-slim AS build
WORKDIR /app

# Lockfile must be committed so CI/Docker match your machine.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

ENV NODE_OPTIONS=--max-old-space-size=4096
# Prisma generate does not connect to MySQL; URL only needed if tooling validates env
ENV DATABASE_URL=mysql://placeholder:placeholder@127.0.0.1:3306/placeholder

RUN npm ci

COPY server server
COPY web web

RUN npm run db:generate -w server
# Work around npm optional-dependency resolution issue in some CI/container runs
# where Rollup's linux binary package is skipped.
RUN npm install --no-save @rollup/rollup-linux-x64-gnu
RUN npm run build -w web
RUN npm run build -w server

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci --omit=dev

COPY server/prisma ./server/prisma

WORKDIR /app/server
RUN npx prisma generate

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
