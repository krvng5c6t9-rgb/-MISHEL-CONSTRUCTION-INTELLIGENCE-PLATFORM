FROM node:22-bookworm-slim
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG VITE_API_BASE_URL=http://localhost:4000/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build
EXPOSE 4173
CMD ["npm","run","preview","--","--host","0.0.0.0","--port","4173"]
