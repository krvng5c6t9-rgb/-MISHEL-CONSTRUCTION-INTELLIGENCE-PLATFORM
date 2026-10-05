FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --no-audit --no-fund
COPY backend/ ./
COPY database/ /app/database/
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/database /app/database
EXPOSE 4000
CMD ["node","dist/server.js"]
