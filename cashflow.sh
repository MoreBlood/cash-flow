#!/usr/bin/env bash
# Управление стеком cashflow одной командой.
#   ./cashflow.sh            — поднять всё и показать адреса
#   ./cashflow.sh status     — состояние контейнеров и URL
#   ./cashflow.sh stop       — остановить стек (данные остаются)
#   ./cashflow.sh update     — обновить образы и пересобрать дашборд
#   ./cashflow.sh dev        — dev-режим дашборда (Vite :5173 + hot-reload)
#   ./cashflow.sh logs [svc] — логи (по умолчанию все)
#   ./cashflow.sh backup        — снапшот data/actual в ICLOUD_BACKUP_DIR
#                                 (авто-бэкап при каждом синке делает контейнер дашборда)
#   ./cashflow.sh backup --full — ПОЛНЫЙ бандл: data/actual + .env + secrets + personal
#                                 (для восстановления с нуля; секреты попадают в iCloud)
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
}

case "${1:-start}" in
  start)
    bold "Запуск стека cashflow"
    ensure_docker
    docker compose up -d --quiet-pull 2>&1 | grep -Ev "Running|Created$" || true
    wait_http http://localhost:5006 "actual-server :5006"
    wait_http http://localhost:5055/api/meta "dashboard :5055" 60
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
  backup)
    # Бэкап в iCloud. Без флага — только data/actual (частый снапшот; авто делает контейнер).
    # С --full — ПОЛНЫЙ бандл для восстановления с нуля:
    #   data/actual + .env + secrets/ + personal/ + settings.json (секреты уходят в iCloud!).
    # Читаем ТОЛЬКО ключи бэкапа из .env (полный source ломается на AI_FEATURES=[...]).
    if [ -f .env ]; then
      while IFS='=' read -r k v; do
        [ -z "${!k:-}" ] && eval "export $k=\"$(eval printf '%s' "\"$v\"")\""
      done < <(grep -E '^(ICLOUD_BACKUP_DIR|BACKUP_KEEP)=' .env 2>/dev/null || true)
    fi
    DEST="${ICLOUD_BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/CashFlow}"
    KEEP="${BACKUP_KEEP:-30}"
    if [ ! -d data/actual ]; then warn "data/actual не найден — нечего бэкапить"; exit 1; fi
    mkdir -p "$DEST"
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' EXIT
    # полный бандл кладём в репо-структуру (data/actual/...); частый — content в корень архива
    if [ "${2:-}" = "--full" ]; then base="$stage/data/actual"; prefix="cashflow-full"; else base="$stage"; prefix="actual"; fi
    mkdir -p "$base"
    # не-sqlite копируем как есть; sqlite — через .backup (консистентно при живом сервере)
    rsync -a --exclude='*.sqlite' --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' \
      data/actual/ "$base/" 2>/dev/null || cp -R data/actual/. "$base/"
    while IFS= read -r f; do
      rel="${f#data/actual/}"
      mkdir -p "$base/$(dirname "$rel")"
      sqlite3 "$f" ".backup '$base/$rel'"
    done < <(find data/actual -name '*.sqlite')
    if [ "${2:-}" = "--full" ]; then
      [ -f .env ] && cp .env "$stage/.env"
      [ -d secrets ] && cp -R secrets "$stage/secrets"
      [ -d personal ] && cp -R personal "$stage/personal"
      [ -f data/dashboard/settings.json ] && { mkdir -p "$stage/data/dashboard"; cp data/dashboard/settings.json "$stage/data/dashboard/"; }
    fi
    arc="$DEST/$prefix-$(date +%Y%m%d-%H%M%S).tgz"
    tar czf "$arc" -C "$stage" .
    # ротация по этому же префиксу: оставить последние KEEP
    ls -1t "$DEST/$prefix-"*.tgz 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
      rm -f "$old"
    done
    ok "Бэкап: $arc ($(du -h "$arc" | cut -f1))"
    [ "${2:-}" = "--full" ] && ok "полный бандл: data/actual + .env + secrets + personal + settings"
    ;;
  *)
    echo "usage: $0 [start|status|stop|update|dev|logs [service]|backup [--full]]"
    exit 1
    ;;
esac
