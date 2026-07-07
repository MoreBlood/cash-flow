#!/usr/bin/env bash
# Управление стеком cashflow одной командой.
#   ./cashflow.sh            — поднять всё и показать адреса
#   ./cashflow.sh status     — состояние контейнеров и URL
#   ./cashflow.sh stop       — остановить стек (данные остаются)
#   ./cashflow.sh update     — обновить образы и пересобрать дашборд
#   ./cashflow.sh dev        — dev-режим дашборда (Vite :5173 + hot-reload)
#   ./cashflow.sh logs [svc] — логи (по умолчанию все)
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

ensure_docker() {
  if ! docker info >/dev/null 2>&1; then
    warn "Docker не запущен — стартую Docker Desktop..."
    open -a Docker
    for _ in $(seq 1 60); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
    docker info >/dev/null 2>&1 || { echo "Docker так и не поднялся"; exit 1; }
  fi
  ok "Docker работает"
}

wait_http() { # url, name, tries
  local url=$1 name=$2 tries=${3:-45}
  for _ in $(seq 1 "$tries"); do
    if curl -sk -o /dev/null --max-time 2 "$url"; then ok "$name"; return 0; fi
    sleep 2
  done
  warn "$name не отвечает ($url)"
}

show_urls() {
  echo
  bold "Адреса:"
  echo "  Дашборд:      http://localhost:5055   (Cash Flow + Капитал)"
  echo "  Actual:       http://localhost:5006   (https://localhost:5443 — для привязки банков)"
  echo "  Grafana:      http://localhost:3000"
}

case "${1:-start}" in
  start)
    bold "Запуск стека cashflow"
    ensure_docker
    docker compose up -d --quiet-pull 2>&1 | grep -Ev "Running|Created$" || true
    wait_http http://localhost:5006 "actual-server :5006"
    wait_http http://localhost:5055/api/meta "dashboard :5055" 60
    wait_http http://localhost:3000/api/health "grafana :3000"
    show_urls
    echo
    docker compose ps --format 'table {{.Name}}\t{{.Status}}'
    ;;
  status)
    ensure_docker
    docker compose ps --format 'table {{.Name}}\t{{.Status}}'
    show_urls
    ;;
  stop)
    bold "Останавливаю стек (данные в ./data остаются)"
    docker compose down
    ;;
  update)
    bold "Обновление образов и пересборка дашборда"
    ensure_docker
    docker compose pull --quiet
    docker compose build dashboard
    docker compose up -d
    ok "готово"
    ;;
  dev)
    bold "Dev-режим дашборда"
    ensure_docker
    # Vite проксирует /api на :5055 — бэкенд поднимаем в контейнере
    if ! curl -s -o /dev/null --max-time 2 http://localhost:5055/api/meta; then
      warn "Бэкенд :5055 не отвечает — поднимаю стек..."
      docker compose up -d --quiet-pull 2>&1 | grep -Ev "Running|Created$" || true
      wait_http http://localhost:5055/api/meta "backend :5055" 60
    else
      ok "Бэкенд :5055 отвечает"
    fi
    if [ ! -d dashboard/web/node_modules ]; then
      warn "Ставлю зависимости фронтенда..."
      npm install --prefix dashboard/web --no-fund --no-audit
    fi
    ok "Vite → http://localhost:5173  (Ctrl+C для выхода)"
    exec npm run dev --prefix dashboard/web
    ;;
  logs)
    docker compose logs -f --tail 100 "${2:-}"
    ;;
  *)
    echo "usage: $0 [start|status|stop|update|dev|logs [service]]"
    exit 1
    ;;
esac
