# Build stage: needs dev dependencies (vite, typescript) to build.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# Runtime stage: production dependencies and the built app only.
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY prisma ./prisma
RUN npx prisma generate
USER node
EXPOSE 3000
# Applies pending migrations, then starts the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
