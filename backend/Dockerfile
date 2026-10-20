# Build context: repository root (the backend needs shared/ data and the feature-extractor WASM).
FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm install --no-save tsx@4
COPY shared ./shared
COPY extension/public/wasm/phishguard.wasm ./extension/public/wasm/phishguard.wasm
COPY backend ./backend
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["npx", "tsx", "src/main.ts"]
