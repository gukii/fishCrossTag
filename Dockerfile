FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install -g pnpm@10.18.3 bun@1.2.5

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "server/api.ts"]
