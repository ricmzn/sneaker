FROM node:lts as frontend
WORKDIR /build

ENV NODE_ENV=production

COPY src src
COPY *.json *.js ./

RUN npm ci --include=dev
RUN npm run build


FROM golang as server
WORKDIR /build

COPY cmd cmd
COPY server server
COPY jambon jambon
COPY assets.go go.mod go.sum ./
COPY --from=frontend /build/dist dist

RUN go build cmd/sneaker-server/main.go


FROM debian
COPY --from=server /build/main /bin/sneaker
CMD ["sneaker", "--bind", "0.0.0.0:80", "--config", "/etc/sneaker/config.json"]
EXPOSE 80/tcp
