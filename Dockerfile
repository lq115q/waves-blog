# 开发与构建用隔离镜像：固定 Node 22 LTS + pnpm（corepack）。
# 选 bookworm-slim（glibc）而非 alpine（musl），以规避 sharp / @resvg/resvg-js
# 预编译原生二进制在 musl 上的兼容问题。
FROM node:22-bookworm-slim

# OG 图（@resvg/resvg-js）在构建期把 SVG 文本栅格化为 PNG，需要系统字体，
# 装 DejaVu（拉丁）+ Noto CJK（中文）以正确渲染中英文标题，避免豆腐块。
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 用 corepack 启用与 package.json packageManager 锁定一致的 pnpm。
RUN corepack enable

# 关闭 Astro 遥测，确定性构建。
ENV ASTRO_TELEMETRY_DISABLED=1 \
    NODE_ENV=development

WORKDIR /app

# 源码通过 volume 挂载（见 docker-compose.yml），镜像本身不打包源码，
# 保证「改代码即生效」且镜像轻量。
EXPOSE 4321 4322

# 默认起开发服务器；Makefile 的 build/preview/check 会覆盖此命令。
CMD ["pnpm", "dev", "--host", "--port", "4321"]
