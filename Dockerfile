FROM --platform=$BUILDPLATFORM node:24.15.0-alpine3.23 AS build

WORKDIR /src

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2.11.3-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/build /srv

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

USER caddy

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
