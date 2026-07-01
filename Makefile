# Blog Web · 容器化开发入口
# 宿主只需 Docker。所有 Node/pnpm 命令都在隔离容器内执行。
# 详见 docs/03-local-development.md。

COMPOSE := docker compose
RUN := $(COMPOSE) run --rm
RUN_PORTS := $(COMPOSE) run --rm --service-ports

.DEFAULT_GOAL := help

.PHONY: help image install dev build preview check format enrich shell clean reset

help: ## 显示可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

image: ## 构建开发镜像
	$(COMPOSE) build

install: ## 安装依赖（生成/更新 pnpm-lock.yaml）
	$(RUN) app pnpm install

dev: ## 启动开发服务器 http://localhost:4321
	$(COMPOSE) up app

build: ## 生产构建 + Pagefind 索引（产物 ./dist）
	$(RUN) -e NODE_ENV=production app pnpm build

preview: ## 本地预览构建产物 http://localhost:4322
	$(RUN_PORTS) app pnpm preview --port 4322 --host

check: ## 类型检查（astro check）
	$(RUN) app pnpm check

format: ## Prettier 格式化
	$(RUN) app pnpm format

enrich: ## 运行 AI 增强流水线（需本机 copilot-proxy:4399，可选）
	$(RUN) --network host app pnpm enrich

shell: ## 进入容器 bash 调试
	$(RUN) app bash

clean: ## 删除构建产物
	$(RUN) app rm -rf dist .astro

reset: ## 停止并删除容器与命名卷（清空 node_modules/pnpm-store）
	$(COMPOSE) down -v
