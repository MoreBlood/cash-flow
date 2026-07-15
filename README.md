# Cash Flow

Self-hosted личная финансовая аналитика для **мультивалютных** банков (Revolut,
PKO BP и др. через Enable Banking). Стек из готовых open-source компонентов вокруг
[Actual Budget](https://actualbudget.org) + собственный дашборд в стиле Revolut с
честной конвертацией валют по курсу НБП на дату каждой операции.

Всё крутится локально в Docker. Наружу уходят только данные для выбранного вами
LLM-провайдера категоризации (при локальном Ollama/LM Studio — вообще ничего).

> ⚠️ Проект не связан с Actual Budget, Revolut, PKO BP или Enable Banking.
> Это личный pet-project, а не финансовый совет. Используйте на свой риск.

---

## Что внутри

| Роль | Компонент | Порт |
|---|---|---|
| База и UI бюджета | `actualbudget/actual-server` | 5006 |
| HTTPS-фасад (для привязки банков) | `caddy` | 5443 |
| Синк банков по расписанию | [`seriouslag/actual-auto-sync`](https://github.com/seriouslag/actual-auto-sync) | — |
| Автокатегоризация (опц.) | [`sakowicz/actual-ai`](https://github.com/sakowicz/actual-ai) | — |
| **Свой дашборд** | `dashboard/` (React + Radix + Vite) | 5055 |
| Дашборды (опц.) | Prometheus + Grafana + [exporter](https://github.com/sakowicz/actual-budget-prometheus-exporter) | 3000 |

Банковский синк — через **Enable Banking** (встроен в Actual; GoCardless/Nordigen
закрыт для новых регистраций). Аналитику словами можно подключить через
[MCP-сервер для Actual](https://github.com/s-stefanov/actual-mcp) в Claude.

### Возможности дашборда (http://localhost:5055)

- Сводка за месяц / произвольный период: доход / расход / net / норма сбережений,
  дельты к прошлому периоду, график накопленного net.
- Категории с раскрытием до мерчантов; переключение «Категории / Мерчанты».
- **Мультивалютность**: суммы хранятся в валюте счёта, конвертация в выбранную
  базовую валюту (PLN/USD/EUR/CHF) по кросс-курсу НБП **на дату операции**.
- Редактирование прямо из UI: смена категории с выбором охвата (одна / за период /
  вся история + правило Actual на будущие синки), «исключить из аналитики».
- Лента операций с модалкой деталей; ручной ввод операций и переводов между счетами.
- Страница **«Капитал»**: балансы всех счетов, история капитала по дням, структура
  по счетам, история отдельного счёта (клик по счёту).
- Ручной банковский синк кнопкой, адаптив под мобильные, состояние фильтров в URL.

---

## Требования

- **Docker Desktop** (или Docker Engine + compose).
- Аккаунт **Enable Banking** для банковского синка ([enablebanking.com](https://enablebanking.com)) —
  бесплатный restricted mode для личного использования.
- Опционально для автокатегоризации: ключ LLM-провайдера (OpenAI/Anthropic) или
  локальный [LM Studio](https://lmstudio.ai) / [Ollama](https://ollama.com).

## Быстрый старт

```bash
git clone <this-repo> cash-flow && cd cash-flow
cp .env.example .env && chmod 600 .env
# отредактируйте .env: ACTUAL_PASSWORD и позже ACTUAL_BUDGET_SYNC_ID

./cashflow.sh          # поднимет Docker, стек и покажет адреса
```

Затем:

1. Откройте **http://localhost:5006**, задайте пароль сервера (тот же, что в `.env`),
   создайте бюджет и счета.
2. Скопируйте **Sync ID** бюджета (Settings → Advanced settings) в `ACTUAL_BUDGET_SYNC_ID`
   в `.env` и перезапустите: `./cashflow.sh`.
3. Настройте банковский синк (см. ниже).
4. Дашборд — на **http://localhost:5055**.

### Управление

```bash
./cashflow.sh            # поднять всё + адреса
./cashflow.sh status     # состояние
./cashflow.sh stop       # остановить (данные остаются в ./data)
./cashflow.sh update     # обновить образы + пересобрать дашборд
./cashflow.sh dev        # dev-режим дашборда (Vite :5173, hot-reload)
./cashflow.sh logs [svc] # логи
```

---

## Банковский синк (Enable Banking)

Enable Banking требует **https** в redirect URL, поэтому в стеке есть Caddy
(`https://localhost:5443` → actual-server) с самоподписанным сертификатом.

1. **[вручную]** На [enablebanking.com](https://enablebanking.com/cp/applications) создайте
   приложение (**Production**), redirect URL: `https://localhost:5443/enablebanking/auth_callback`.
   Сгенерируйте ключ в браузере — скачается `.pem`; скопируйте Application ID.
2. Положите `.pem` в `secrets/` (`chmod 600`). Активируйте приложение в панели EB,
   привязав свои счета (restricted mode).
3. В Actual (**через https://localhost:5443**): More → Bank Sync → Set up Enable Banking
   (App ID + ключ). Затем на каждом счёте Link account.
4. `actual-auto-sync` тянет транзакции по расписанию (`AUTO_SYNC_CRON`, по умолчанию 07:30).

> Согласие PSD2 живёт ~90 дней, потом требуется переподтверждение — это норма,
> не поломка. В логах `actual-auto-sync` при протухшем согласии будет ошибка авторизации.

---

## Настройки (⚙ в шапке дашборда)

Всё, что зависит от структуры вашего бюджета, настраивается на странице **«Настройки»**
(иконка ⚙), а не правкой файлов. Хранится в `data/dashboard/settings.json`:

- **Группа исключений** — какая группа категорий исключается из cash flow (переводы
  между счетами, обмены валют, отменённые платежи). По умолчанию «Переводы и обмены».
- **Категория для «Исключить из аналитики»** и **для переводов между счетами** — какие
  категории использовать для этих действий (если не заданы — берутся по имени из группы
  исключений: `Исключено`, `Переводы между счетами`).
- **Валюты счетов** — у Actual нет мультивалютности, поэтому валюта счёта по умолчанию
  определяется по названию (`EUR`/`USD`/`CHF` в имени, иначе `PLN`). В настройках можно
  задать валюту каждого счёта явно.

Базовая валюта отображения (PLN/USD/EUR/CHF) выбирается в шапке. Курсы берутся из
бесплатного API НБП (Народный банк Польши) на дату каждой операции.

> Иконки/цвета категорий заданы в `dashboard/web/src/shared/config/categories.ts` —
> при желании отредактируйте под свои названия категорий.

---

## Опционально

- **Автокатегоризация** (`actual-ai`, профиль `ai`): выберите LLM-провайдера в `.env`
  (`LLM_PROVIDER` + ключи). Локально — LM Studio/Ollama (данные не покидают машину).
- **Grafana-дашборды** (профиль `dashboards`): http://localhost:3000, дашборд
  предзагружен через provisioning.
- **Аналитика словами через Claude**: подключите
  [`s-stefanov/actual-mcp`](https://github.com/s-stefanov/actual-mcp) как MCP-сервер.

Профили включаются переменной `COMPOSE_PROFILES` в `.env`.

## Разработка

```bash
./cashflow.sh dev   # поднимает бэкенд-контейнер (:5055) + Vite (:5173) с hot-reload
```

Дашборд: `dashboard/server` (Node + `@actual-app/api`, HTTP API) и `dashboard/web`
(React 19, TypeScript, Vite, Radix Themes, recharts, Biome, FSD-структура).

## Бэкап / восстановление

Все данные — в `./data/actual/` (обычные SQLite). Есть три пути:

**Автоматически при каждом синке.** После успешного банк-синка дашборд делает
консистентный снапшот `data/actual` (через SQLite online-backup, без остановки сервера)
и кладёт архив `actual-<дата>.tgz` в `ICLOUD_BACKUP_DIR`. По умолчанию — iCloud Drive;
задайте путь в `.env` (`ICLOUD_BACKUP_DIR`, `BACKUP_KEEP` — сколько архивов хранить).
Работает через bind-mount папки бэкапов в контейнер, поэтому не упирается в ограничения
macOS для фоновых процессов.

**Вручную в любой момент:**

```bash
./cashflow.sh backup      # снапшот data/actual в ICLOUD_BACKUP_DIR (с ротацией)
```

**Восстановление:** остановите стек, распакуйте архив в `data/actual`, поднимите заново:

```bash
docker compose down
tar xzf "<путь>/actual-YYYYMMDD-HHMMSS.tgz" -C data/actual
./cashflow.sh
```

> ⚠️ Живую БД SQLite нельзя синкать облаком напрямую (WAL + дозапись = битый бэкап).
> Поэтому бэкапится **снапшот**, а не рабочая папка — не кладите `data/` в iCloud «как есть».

## Приватность

Данные хранятся локально. Наружу уходит только: обращения к выбранному LLM-провайдеру
(если включена автокатегоризация — при Ollama/LM Studio ничего), запросы курсов к
публичному API НБП, и, собственно, банковский синк через Enable Banking. Секреты —
только в `.env` (600) и `secrets/`, оба в `.gitignore`.

## Лицензия

[MIT](LICENSE).

> UI дашборда пока на русском языке. PR с интернационализацией приветствуются.
