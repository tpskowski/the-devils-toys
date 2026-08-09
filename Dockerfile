FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY tables-client/package.json tables-client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY systems/cairn/package.json systems/cairn/package.json
COPY systems/cwn/package.json systems/cwn/package.json
COPY systems/monolith/package.json systems/monolith/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DEVILS_TABLES_PORT=4100 \
    DEVILS_TOYS_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/tables-client/dist ./tables-client/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/raw/*.md ./raw/
COPY --from=build /app/raw/tables/*.json ./raw/tables/
COPY --from=build /app/docs/guide ./docs/guide
COPY --from=build /app/credits.md /app/changelog.md /app/roadmap.md /app/devils-tables.md /app/NOTICE.md ./
VOLUME ["/data"]
EXPOSE 4000
CMD ["npm", "start"]
