# Container image for Glama.ai introspection + general containerized use.
#
# Glama builds this image, runs the stdio MCP server, and calls tools/list to
# evaluate + score the server. A placeholder API key lets the server boot for
# introspection - listing tools makes no backend call, so no real credentials
# are needed. Real users still supply their own AETHERWAVE_API_KEY via their MCP
# client (npx is the normal install; this Dockerfile is for registries/hosting).
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Placeholder so `node dist/index.js` boots during introspection (tools/list
# requires no real key). Overridden by the user's real key at runtime.
ENV AETHERWAVE_API_KEY=aw_live_glama_introspection_placeholder

CMD ["node", "dist/index.js"]
