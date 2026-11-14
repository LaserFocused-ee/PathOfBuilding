# Path of Building API and MCP server in one image.
# Build from the repository root:  docker build -f api/deploy/Dockerfile -t pob-api .
# Run:  docker run -e POB_API_TOKEN=<32+ chars> -p 127.0.0.1:8730:8730 -v pob-data:/data pob-api
# Only the paths the worker and server need are copied, so local build output never enters the image.

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

FROM node:22.22.2-bookworm-slim
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
