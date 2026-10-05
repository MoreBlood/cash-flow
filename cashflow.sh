#!/usr/bin/env bash
# Управление cashflow одной командой. Сервер — нативный Node под launchd (без Docker).
#   ./cashflow.sh install       — собрать фронт, прописать launchd-агент и запустить (старт при входе в систему)
#   ./cashflow.sh               — то же, что status
#   ./cashflow.sh start|stop|restart
#   ./cashflow.sh status        — состояние агента, синка и согласий банков
#   ./cashflow.sh logs          — лог сервера (tail -f)
#   ./cashflow.sh build         — пересобрать фронтенд (сервер отдаёт его с диска, рестарт не нужен)
#   ./cashflow.sh dev           — Vite :5173 с hot-reload поверх сервера :5055
#   ./cashflow.sh sync          — банк-синк сейчас
#   ./cashflow.sh backup        — снапшот базы в ICLOUD_BACKUP_DIR (авто — после каждого синка)
#   ./cashflow.sh backup --full — ПОЛНЫЙ бандл: база + .env + secrets + personal
#                                 (для восстановления с нуля; секреты попадают в iCloud)
#   ./cashflow.sh uninstall     — убрать launchd-агент (данные остаются)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

LABEL=com.cashflow.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
URL=http://localhost:5055
DB=data/cashflow.sqlite

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# читаем из .env только нужные ключи (значения без кавычек, $HOME раскрываем)
env_get() {
  local v
  v="$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "${v//\$HOME/$HOME}"
}

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

wait_http() {
  for _ in $(seq 1 30); do
    curl -s -o /dev/null --max-time 2 "$URL/api/meta" && { ok "сервер отвечает: $URL"; return 0; }
    sleep 1
  done
  warn "сервер не отвечает — смотрите ./cashflow.sh logs"
  return 1
}

build_web() {
  if [ ! -d dashboard/web/node_modules ]; then
    warn "ставлю зависимости фронтенда..."
    npm ci --prefix dashboard/web --no-fund --no-audit
  fi
  npm run build --prefix dashboard/web >/dev/null
  ok "фронтенд собран → dashboard/web/dist"
}

write_plist() {
  local node
  node="$(command -v node)" || { echo "нужен Node.js ≥ 22.16"; exit 1; }
  "$node" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)' \
    || { echo "нужен Node.js ≥ 22.16 (встроенный node:sqlite), сейчас $("$node" -v)"; exit 1; }
  mkdir -p "$(dirname "$PLIST")" data/logs
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$ROOT/dashboard/server/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT/data/logs/server.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/server.log</string>
</dict>
</plist>
EOF
  ok "launchd-агент: $PLIST (node $("$node" -v))"
}

status() {
  if loaded; then
    ok "агент $LABEL запущен (pid $(launchctl print "$DOMAIN/$LABEL" | awk '/pid =/{print $3; exit}'))"
  else
    warn "агент не запущен — ./cashflow.sh start"
  fi
  curl -s --max-time 3 "$URL/api/sync-status" | node -e '
    let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
      if (!s) return console.log("  ! сервер не отвечает");
      const j = JSON.parse(s);
      console.log(`  синк: ${j.lastBankSyncAt ?? "ещё не было"}${j.failedAccounts?.length ? `, не синкаются: ${j.failedAccounts.join(", ")}` : ""}`);
      for (const e of j.expiring ?? []) console.log(`  ! согласие ${e.bank} кончается ${e.consentUntil.slice(0, 10)}`);
    });' || true
  echo "  Дашборд: $URL"
}

case "${1:-status}" in
  install)
    bold "Установка cashflow"
    build_web
    write_plist
    loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    wait_http
    ;;
  start)
    [ -f "$PLIST" ] || { "$0" install; exit; }
    loaded || launchctl bootstrap "$DOMAIN" "$PLIST"
    wait_http
    ;;
  stop)
    loaded && launchctl bootout "$DOMAIN/$LABEL" && ok "остановлен (запустится снова при входе в систему или ./cashflow.sh start)"
    ;;
  restart)
    loaded && launchctl kickstart -k "$DOMAIN/$LABEL" || launchctl bootstrap "$DOMAIN" "$PLIST"
    wait_http
    ;;
  status)
    status
    ;;
  logs)
    tail -n 100 -f data/logs/server.log
    ;;
  build)
    build_web
    ;;
  dev)
    bold "Dev-режим фронтенда (Vite проксирует /api на :5055)"
    curl -s -o /dev/null --max-time 2 "$URL/api/meta" || "$0" start
    [ -d dashboard/web/node_modules ] || npm ci --prefix dashboard/web --no-fund --no-audit
    ok "Vite → http://localhost:5173  (Ctrl+C для выхода)"
    exec npm run dev --prefix dashboard/web
    ;;
  sync)
    bold "Банк-синк"
    curl -s -X POST "$URL/api/bank-sync" && echo
    ;;
  backup)
    DEST="$(env_get ICLOUD_BACKUP_DIR)"
    DEST="${DEST:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/CashFlow}"
    KEEP="$(env_get BACKUP_KEEP)"
    KEEP="${KEEP:-30}"
    [ -f "$DB" ] || { warn "$DB не найден — нечего бэкапить"; exit 1; }
    mkdir -p "$DEST"
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' EXIT
    mkdir -p "$stage/data"
    # .backup — консистентный снапшот при живом сервере
    sqlite3 "$DB" ".backup '$stage/data/cashflow.sqlite'"
    if [ "${2:-}" = "--full" ]; then
      prefix=cashflow-full
      [ -f .env ] && cp .env "$stage/.env"
      [ -d secrets ] && cp -R secrets "$stage/secrets"
      [ -d personal ] && cp -R personal "$stage/personal"
      arc="$DEST/$prefix-$(date +%Y%m%d-%H%M%S).tgz"
      tar czf "$arc" -C "$stage" .
    else
      prefix=cashflow
      arc="$DEST/$prefix-$(date +%Y%m%d-%H%M%S).sqlite.gz"
      gzip -c "$stage/data/cashflow.sqlite" >"$arc"
    fi
    # ротация по префиксу: оставить последние KEEP
    ls -1t "$DEST/$prefix-"[0-9]* 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
      rm -f "$old"
    done
    ok "бэкап: $arc ($(du -h "$arc" | cut -f1))"
    [ "${2:-}" = "--full" ] && ok "полный бандл: база + .env + secrets + personal"
    ;;
  uninstall)
    loaded && launchctl bootout "$DOMAIN/$LABEL" || true
    rm -f "$PLIST"
    ok "агент удалён (данные в ./data на месте)"
    ;;
  *)
    echo "usage: $0 [install|start|stop|restart|status|logs|build|dev|sync|backup [--full]|uninstall]"
    exit 1
    ;;
esac
