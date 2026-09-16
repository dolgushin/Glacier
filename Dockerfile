FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
# lib/crypto.ts reads GLACIER_SECRET whenever NODE_ENV=production (next build
# sets it), so a throwaway value keeps the build green. The real secret
# arrives at runtime through .env / docker-compose.
ENV GLACIER_SECRET=build-time-not-a-real-secret-0000000000000000
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts
# npm start runs through node scripts/with-ca.mjs, so the scripts dir
# must exist at runtime (it only needs with-ca.mjs, but the whole dir
# is tiny and future-proof).
COPY --from=build /app/scripts ./scripts
# The CA bundle is tracked in the repo; with-ca.mjs picks it up from
# the working directory so T-Invest works with no extra setup.
COPY --from=build /app/certs ./certs
EXPOSE 3000
CMD ["npm", "start"]