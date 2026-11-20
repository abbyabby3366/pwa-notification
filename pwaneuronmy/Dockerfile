FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:lts-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV UPSTREAM_URL=https://statsdashboard.onrender.com
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "dist-server/index.js"]
