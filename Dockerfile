FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY . .
