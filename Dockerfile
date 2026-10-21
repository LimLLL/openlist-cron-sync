# 构建后端与网页控制台；运行镜像只保留编译产物、生产依赖和迁移目录。
# 构建阶段在构建机原生架构上运行：产物是纯 JS，better-sqlite3 自带各平台预编译二进制。
# Node 固定为与本地开发、测试相同的精确版本；升级时三个阶段一起改这里。
ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:all

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --prod --frozen-lockfile --filter openlist-cron-sync

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY drizzle ./drizzle
COPY package.json LICENSE ./
# 预建数据目录并交给 node 用户（uid 1000），新建的命名卷会继承该属主。
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/system/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
