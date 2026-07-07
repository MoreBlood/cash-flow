FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY web .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY server/server.mjs ./
COPY --from=web /web/dist ./public
ENV STATIC_DIR=./public DATA_DIR=/data PORT=5055
EXPOSE 5055
CMD ["node", "server.mjs"]
