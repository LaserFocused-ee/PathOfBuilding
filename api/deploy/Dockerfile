# Path of Building API and MCP server in one image, with the browser view (api/web) served at /.
# Build from the repository root:  docker build -f api/deploy/Dockerfile -t pob-api .
#   API and MCP only (no web toolchain, much faster): add --target api
# Run:  docker run -e POB_API_TOKEN=<32+ chars> -p 127.0.0.1:8730:8730 -v pob-data:/data pob-api
# Only the paths the worker, server and view build need are copied, so local build output never enters the image.
# The view leaves out the Fontin font files: an image must not hold them (api/web/THIRD-PARTY.md).

FROM node:22.22.2-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git gcc libc6-dev make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /pob
COPY api/runtime/build-runtime.sh api/runtime/
RUN api/runtime/build-runtime.sh
COPY api/server/package.json api/server/package-lock.json api/server/
RUN cd api/server && npm ci
COPY api/server/tsconfig.json api/server/
COPY api/server/src api/server/src
RUN cd api/server && npm run build
RUN cd api/server && npm prune --omit=dev

# The browser view: api/web/build-web.sh fetches its toolchains at their pins (cmake 3.28+ needs trixie).
FROM debian:trixie-slim AS web
ARG DENO_VERSION=2.9.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils git gcc g++ make cmake ninja-build python3 \
 && rm -rf /var/lib/apt/lists/*
RUN set -e; a="$(uname -m)"; \
    case "$a" in \
      x86_64) sum=8b010a3b1a4a0188a67cdb8a7a27348b2a501af78aec7fc74f2ace167368d530 ;; \
      aarch64) sum=6b7cae3a8fc4385a59dea3146fcb8bad7fea4230e0ad36a8c692afacbc254be0 ;; \
      *) echo "no deno pin for $a" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-$a-unknown-linux-gnu.zip"; \
    echo "$sum  /tmp/deno.zip" | sha256sum -c -; \
    unzip -q /tmp/deno.zip -d /usr/local/bin; rm /tmp/deno.zip
# build-web.sh refuses output that names the build directory or $HOME; the page itself serves /pob/<version> and
# pob-web's code holds "/app/root/", so neither /pob nor /root is used here.
ENV HOME=/home/builder
WORKDIR /work/PathOfBuilding
COPY --from=build /pob/api/runtime/rt /opt/pob-rt
# .gitignore: the in-stage commit leaves out what git ignores, and build-web.sh checks the packed tree against it.
COPY .gitignore LICENSE.md manifest.xml changelog.txt help.txt ./
COPY src src
COPY runtime/lua runtime/lua
COPY api/lua api/lua
COPY api/server/test/fixtures/witch-elementalist-3_30.xml api/server/test/fixtures/
COPY api/web/build-web.sh api/web/deno.json api/web/deno.lock api/web/THIRD-PARTY.md api/web/
COPY api/web/patches api/web/patches
COPY api/web/src api/web/src
COPY api/web/tools api/web/tools
# build-web.sh packs a git commit: commit the copied tree (fixed identity and date: same tree, same id).
RUN git init -q \
 && git add -A \
 && GIT_AUTHOR_NAME=image GIT_AUTHOR_EMAIL=image@localhost GIT_AUTHOR_DATE=2000-01-01T00:00:00Z \
    GIT_COMMITTER_NAME=image GIT_COMMITTER_EMAIL=image@localhost GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
    git commit -q -m "image tree" \
 && POB_RUNTIME_DIR=/opt/pob-rt api/web/build-web.sh

FROM node:22.22.2-bookworm-slim AS api
WORKDIR /pob
COPY LICENSE.md manifest.xml ./
COPY src src
COPY runtime/lua runtime/lua
COPY api/lua api/lua
COPY --from=build /pob/api/runtime/rt api/runtime/rt
COPY --from=build /pob/api/server/package.json api/server/
COPY --from=build /pob/api/server/node_modules api/server/node_modules
COPY --from=build /pob/api/server/dist api/server/dist
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8730 POB_DATA_DIR=/data
VOLUME /data
EXPOSE 8730
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "api/server/dist/src/index.js"]

# Default target: the API with the browser view at / (the server serves api/web/dist when it exists).
FROM api
COPY --from=web /work/PathOfBuilding/api/web/dist api/web/dist
