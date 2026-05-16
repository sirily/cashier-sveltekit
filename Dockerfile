FROM node:24-alpine AS build

WORKDIR /src

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/build /srv

EXPOSE 80
