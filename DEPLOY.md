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

## 3. Переменные окружения

Vercel → Project → Settings → Environment Variables:

| Переменная | Значение |
|---|---|
| `GITHUB_CLIENT_ID` | из шага 2 |
| `GITHUB_CLIENT_SECRET` | из шага 2 |
| `ALLOWED_GITHUB_USERS` | ваш логин GitHub (несколько — через запятую) |

Затем Deployments → ⋯ → **Redeploy**. Это единственная настройка вне интерфейса.

## 4. Всё остальное — в интерфейсе

Войдите через GitHub.

- **Банки** → «Подключение к Enable Banking»: в [панели Enable Banking](https://enablebanking.com/cp/applications)
  создайте приложение (Production) с redirect URL, который показан на странице, сгенерируйте ключ и
  загрузите `.pem` — Application ID подставится сам, ключ проверится и сохранится в базе зашифрованным.
  Активируйте приложение, привязав свои счета (restricted-режим: доступ только к вашим счетам).
  Затем «Подключить банк». Согласие берётся на максимум банка (Revolut и PKO — 180 дней).
- **Настройки → Перенос данных** — если данные уже есть в другой установке (например, локальной):
  там «Скачать экспорт», здесь «Загрузить из файла». С тем же приложением Enable Banking счета
  продолжат синкаться без переподключения банков.
- Синк — кнопкой «↻ Обновить» и автоматически раз в день (около 07:30 по Варшаве).
- **Ассистенты (MCP).** Адрес — в «Настройках», вида `https://<проект>.vercel.app/mcp`:
  - **Claude** (веб, Desktop, телефон): Настройки → Коннекторы → «Добавить свой коннектор» → адрес →
    «Подключить», войти через GitHub и разрешить доступ;
  - **ChatGPT**: Настройки → Приложения и коннекторы → Расширенные → режим разработчика → «Создать» →
    тот же адрес, аутентификация OAuth;
  - **Claude Code**: `claude mcp add --transport http cashflow https://<проект>.vercel.app/mcp`.

## Обновления

Кнопка создаёт копию репозитория (не форк). Новая версия подтягивается так:

- **Автоматически по понедельникам** и **по кнопке**: в своём репозитории на GitHub → Actions →
  «Обновиться из MoreBlood/cash-flow» → Run workflow. Vercel пересоберёт сайт сам, миграции базы
  применятся при сборке. Не хотите автообновлений — Actions → этот workflow → ⋯ → Disable workflow.
- Если обновление меняет сами файлы в `.github/workflows/`, стандартный токен GitHub не может их
  записать и запуск упадёт — тогда один раз вручную:

```bash
git clone https://github.com/<вы>/cashflow && cd cashflow
git remote add upstream https://github.com/MoreBlood/cash-flow
git fetch upstream && git merge upstream/main --allow-unrelated-histories -X theirs -m "Обновление" && git push
```

Поменяли только переменные окружения — Vercel → Deployments → ⋯ → Redeploy.
