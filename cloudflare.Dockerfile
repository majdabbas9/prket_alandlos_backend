# Cloudflare Containers image: the app image (Dockerfile) with a lighter start command.
# Built and pushed to the Cloudflare registry by .github/workflows/docker-publish.yml;
# prket_alandlos_infra deploys it by tag.
# No Redis here: on Cloudflare the cache is Workers KV, reached through the API Worker
# (CACHE_URL, see src/utils/cacheManager.js).
# Runtime env/ports live in prket_alandlos_infra: containers/src/index.ts (Cloudflare) and
# containers/docker-compose.yml (local).
ARG BASE_IMAGE=ghcr.io/majdabbas9/prket_alandlos_backend:latest
FROM ${BASE_IMAGE}

# Skip npm: node is PID 1 and gets SIGTERM directly when the container stops
CMD ["node", "server.js"]
