# Своя копия на Vercel

Кнопка ниже разворачивает **вашу собственную** копию сервиса: свой проект на Vercel, своя база
Turso, свой вход через GitHub и своё приложение Enable Banking. Ваши банковские данные видите
только вы — автор проекта к ним доступа не имеет.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMoreBlood%2Fcash-flow&project-name=cashflow&repository-name=cashflow&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22tursocloud%22%2C%22productSlug%22%3A%22database%22%2C%22protocol%22%3A%22storage%22%7D%5D)

Всё бесплатно: Vercel Hobby, Turso Free, Enable Banking в restricted-режиме (только ваши счета).

## 1. Развернуть

Нажмите кнопку, войдите в Vercel через GitHub, подтвердите создание репозитория и базы Turso.
Через пару минут сайт откроется по адресу вида `https://<проект>.vercel.app` и покажет
**страницу настройки** с точными адресами для следующих шагов. Пока шаги не пройдены, данные закрыты.

## 2. Вход через GitHub

[Создайте OAuth App](https://github.com/settings/applications/new):

- **Homepage URL**: `https://<проект>.vercel.app`
- **Authorization callback URL**: `https://<проект>.vercel.app/api/auth/callback/github`

Скопируйте Client ID и сгенерируйте Client secret.

## 3. Банк через Enable Banking

В [панели Enable Banking](https://enablebanking.com/cp/applications) создайте приложение:

- environment **Production**, redirect URL `https://<проект>.vercel.app/enablebanking/auth_callback`;
- ключ сгенерируйте в браузере — скачается `<application-id>.pem`;
- активируйте приложение, привязав свои счета (restricted-режим: доступ только к вашим счетам).

## 4. Переменные окружения

Vercel → Project → Settings → Environment Variables:

| Переменная | Значение |
|---|---|
| `GITHUB_CLIENT_ID` | из шага 2 |
| `GITHUB_CLIENT_SECRET` | из шага 2 |
| `ALLOWED_GITHUB_USERS` | ваш логин GitHub (несколько — через запятую) |
| `EB_APP_ID` | Application ID из шага 3 |
| `EB_PRIVATE_KEY` | содержимое `.pem` целиком (вместе со строками BEGIN/END) |

Затем Deployments → ⋯ → **Redeploy**.

## 5. Пользоваться

- Войдите через GitHub → **Банки** → «Подключить банк». Согласие берётся на максимум, который даёт
  банк (Revolut и PKO — 180 дней); за 14 дней до конца в шапке появится напоминание.
- Синк — кнопкой «↻ Обновить» и автоматически раз в день (около 07:30 по Варшаве).
- **Ассистенты (MCP).** Адрес — в «Настройках», вида `https://<проект>.vercel.app/mcp`:
  - **Claude** (веб, Desktop, телефон): Настройки → Коннекторы → «Добавить свой коннектор» → адрес →
    «Подключить», войти через GitHub и разрешить доступ;
  - **ChatGPT**: Настройки → Приложения и коннекторы → Расширенные → режим разработчика → «Создать» →
    тот же адрес, аутентификация OAuth;
  - **Claude Code**: `claude mcp add --transport http cashflow https://<проект>.vercel.app/mcp`.

## Обновления

Ваш репозиторий — копия на момент развёртывания. Чтобы подтянуть новую версию, нажмите в нём на
GitHub «Sync fork» (или влейте изменения из `MoreBlood/cash-flow`) — Vercel пересоберёт сайт сам,
миграции базы применятся при сборке.
