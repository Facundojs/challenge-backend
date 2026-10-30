.DEFAULT_GOAL := help
.PHONY: help install env migrate migrate-status migrate-rollback migrate-make api worker test test-unit test-integration typecheck up down

help:
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-18s %s\n", $$1, $$2}'

migrate: ## Aplica las migraciones pendientes (knex)
	npm run migrate

migrate-status: ## Lista migraciones aplicadas/pendientes
	npm run migrate:status

migrate-rollback: ## Revierte el último lote de migraciones
	npm run migrate:rollback

migrate-make: ## Crea una migración nueva: make migrate-make name=agregar_algo
	@test -n "$(name)" || (echo "Uso: make migrate-make name=<nombre>" && exit 1)
	npm run migrate:make -- $(name)

api: ## Levanta la API en modo desarrollo (:3000)
	npm run dev:api

worker: ## Levanta el worker en modo desarrollo
	npm run dev:worker

test: ## Corre unit e integration tests
	npm test

test-unit: ## Unit tests (sin base de datos)
	npm run test:unit

test-integration: ## Integration tests (requieren Postgres; usan un schema temporal)
	npm run test:integration

typecheck: ## Chequea tipos con tsc
	npm run typecheck

up: ## Levanta api + worker con Docker (make up WORKERS=3 para escalar)
	docker compose up --build --scale worker=$(or $(WORKERS),1)

down: ## Baja los contenedores
	docker compose down
