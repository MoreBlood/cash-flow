# Восстановление (disaster recovery)

Ноутбук потерян / стёрт? Это пошаговый план поднять всё заново и ничего не потерять.

## Где что лежит

- **Код + история** — приватный репозиторий GitHub: `MoreBlood/cash-flow`.
- **Данные, секреты, личное** — снапшоты в iCloud Drive:
  `~/Library/Mobile Documents/com~apple~CloudDocs/CashFlow/`
  - `cashflow-full-<дата>.tgz` — **полный бандл**: `data/actual` + `.env` + `secrets/` +
    `personal/` + `settings.json`.
  - `actual-<дата>.tgz` — только бюджет (свежий снапшот на каждый банк-синк).

> Секреты (`.env`, ключи Enable Banking) есть **только** в `cashflow-full-*.tgz` в iCloud —
> в GitHub их нет by design (`.gitignore`).

## Что нужно на новой машине

- macOS + **Docker Desktop** (установить и запустить).
- Доступ к своему GitHub (`gh auth login`, либо обычные git-креды).
- Доступ к своему iCloud Drive (войти под своим Apple ID и дождаться, пока папка
  `CashFlow` скачается — файлы должны быть не «облачными», а реально на диске).

## Восстановление

```bash
# 0. папка бэкапов в iCloud
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CashFlow"

# 1. код
git clone https://github.com/MoreBlood/cash-flow.git cash-flow
cd cash-flow

# 2. полный бандл поверх (data/actual + .env + secrets + personal + settings)
tar xzf "$(ls -t "$ICLOUD"/cashflow-full-*.tgz | head -1)" -C .

# 3. (опц.) самый свежий снапшот бюджета поверх бандла
tar xzf "$(ls -t "$ICLOUD"/actual-*.tgz | head -1)" -C data/actual

# 4. права на секреты и запуск
chmod 600 .env secrets/*.pem 2>/dev/null || true
./cashflow.sh
```

Открой **http://localhost:5055** — дашборд и «Капитал» должны быть на месте со всей историей.

## После восстановления: переподключить банки

Согласие Enable Banking (PSD2) живёт ~90 дней и после переезда почти наверняка протухло.
Ключ `.pem` и App ID уже восстановлены из бандла, поэтому **заново регистрировать
приложение не нужно** — только переподтвердить согласие:

1. Открой Actual через **https://localhost:5443** (не `:5006` — для редиректа нужен https).
2. More → Bank sync → у каждого счёта Re-link / повторная авторизация.
3. Проверь синк кнопкой «Обновить» в дашборде.

## Проверка, что всё на месте

```bash
ls .env secrets/*.pem            # конфиг и ключи EB
ls personal/                     # личные заметки
sqlite3 data/actual/user-files/group-*.sqlite "PRAGMA integrity_check;"   # бюджет → ok
```

## Свежесть бэкапов (чтобы «не потерять ничего»)

- **Бюджет** бэкапится сам при каждом банк-синке — всегда свежий.
- **Секреты / `.env` / `personal`** попадают в iCloud только при `./cashflow.sh backup --full`.
  Запускай это **после смены секретов, конфига или личных заметок**.
- **Код** — `git push` после изменений.

## Если что-то не поднялось

- Docker не запущен → `./cashflow.sh` сам попробует стартовать Docker Desktop.
- Порт занят → `docker compose down`, затем снова `./cashflow.sh`.
- Состояние и логи: `./cashflow.sh status`, `./cashflow.sh logs`.
- Пусто в дашборде, но контейнеры живы → подожди первый синк или нажми «Обновить»;
  клиент домердживает CRDT-сообщения из `data/actual` не мгновенно.
