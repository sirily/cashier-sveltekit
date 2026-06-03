FROM --platform=$BUILDPLATFORM node:24.15.0-alpine3.23 AS build

WORKDIR /src

COPY package*.json ./
COPY .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2.11.3-alpine

# Ensure caddy user exists and has ownership of runtime files
RUN if ! grep -q '^caddy:' /etc/group; then addgroup -S caddy; fi \
    && if ! grep -q '^caddy:' /etc/passwd; then adduser -S -D -H -h /srv -s /sbin/nologin -G caddy caddy; fi \
    && mkdir -p /srv /etc/caddy /data /config \
    && chown -R caddy:caddy /srv /etc/caddy /data /config
COPY --chown=caddy:caddy docker/Caddyfile /etc/caddy/Caddyfile
COPY --chown=caddy:caddy --from=build /src/build /srv

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

USER caddy

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
