# Восстановление (disaster recovery)

Ноутбук потерян или стёрт? Это пошаговый план, как поднять всё заново без потерь.

## Облачная установка (Vercel)

Данные живут в базе Turso, ноутбук для работы не нужен. Резервная копия — «Настройки → Перенос
данных → Скачать экспорт» (счета, операции, категории, правила, настройки одним файлом; делайте
время от времени и храните, например, в iCloud). Если проект или база потеряны: разверните новую
копию по [DEPLOY.md](DEPLOY.md), загрузите ключ Enable Banking на странице «Банки» и экспорт —
в «Настройки → Перенос данных → Загрузить из файла». С тем же приложением Enable Banking счета
продолжат синкаться без переподключения банков.

Дальше — восстановление **локальной** установки (Mac, launchd).

## Где что лежит

- **Код и история** — репозиторий GitHub `MoreBlood/cash-flow`.
- **Данные, секреты, личное** — в iCloud Drive:
  `~/Library/Mobile Documents/com~apple~CloudDocs/CashFlow/`
  - `cashflow-full-<дата>.tgz` — **полный бандл**: `data/cashflow.sqlite` + `.env` +
    `secrets/` + `personal/`.
  - `cashflow-<дата>.sqlite.gz` — только база, свежий снапшот после каждого банк-синка.
  - `actual-<дата>.tgz` — архив эпохи Actual Budget (до 2026-10-05), для восстановления не нужен.

> Секреты (`.env`, ключ Enable Banking) есть **только** в `cashflow-full-*.tgz` в iCloud —
> в GitHub их нет by design.

## Что нужно на новой машине

- macOS + **Node.js ≥ 22.18** (например, `nvm install 22`).
- Доступ к GitHub (`gh auth login`).
- iCloud Drive под своим Apple ID; дождаться, пока папка `CashFlow` скачается
  (файлы должны быть на диске, а не «в облаке»).

## Восстановление

```bash
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CashFlow"

# 1. код — НЕ в ~/Documents/~/Desktop: туда macOS не пускает фоновые процессы
mkdir -p ~/Developer && cd ~/Developer
git clone https://github.com/MoreBlood/cash-flow.git && cd cash-flow

# 2. полный бандл (база + .env + secrets + personal)
tar xzf "$(ls -t "$ICLOUD"/cashflow-full-*.tgz | head -1)" -C .

# 3. самый свежий снапшот базы поверх бандла (он новее)
gunzip -c "$(ls -t "$ICLOUD"/cashflow-2*.sqlite.gz | head -1)" > data/cashflow.sqlite

# 4. права на секреты и запуск
chmod 600 .env secrets/*.pem
./cashflow.sh install
```

Открой **http://localhost:5055** — дашборд, «Капитал» и вся история на месте.

## После восстановления: банки

Если согласие PSD2 ещё живо (видно на странице **«Банки»**), синк просто продолжит
работать: ключ `.pem` и `EB_APP_ID` восстановлены из бандла. Если истекло — «Банки» →
«Переподключить» у банка; счета перепривяжутся сами, история не пострадает. Браузер один
раз спросит про самоподписанный сертификат `https://localhost:5443` — это наш сервер.

## Проверка

```bash
./cashflow.sh status                                         # агент жив, дата синка, согласия
sqlite3 data/cashflow.sqlite "PRAGMA integrity_check;"       # → ok
ls .env secrets/*.pem personal/
```

## Свежесть бэкапов

- **База** бэкапится сама после каждого банк-синка (минимум раз в день по расписанию).
- **Секреты / `.env` / `personal`** попадают в iCloud только при `./cashflow.sh backup --full` —
  запускай после смены ключей, конфига или личных заметок.
- **Код** — `git push` после изменений.

## Если что-то не поднялось

- `./cashflow.sh logs` — лог сервера; `./cashflow.sh restart` — перезапуск.
- «нужен Node.js ≥ 22.18» → обнови Node и снова `./cashflow.sh install` (путь к node
  прописывается в launchd-агент при установке).
- Порт 5055/5443 занят → `lsof -i :5055`, освободить и `./cashflow.sh restart`.
