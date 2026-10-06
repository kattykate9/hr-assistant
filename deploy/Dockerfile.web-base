FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web/package.json /web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /web/.next ./.next
COPY --from=build /web/public ./public
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
