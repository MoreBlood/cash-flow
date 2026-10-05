// Конфиг входа для облачной установки (Better Auth): GitHub для браузера + OAuth 2.1-сервер для MCP-коннекторов
// (claude.ai, ChatGPT и др. подключаются вставкой https://…/mcp). Локально вход выключен:
// сервер слушает только 127.0.0.1.
import { createHash } from 'node:crypto';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';

/** Облако (Vercel) или явно включённый вход. Без настроек в облаке сервис закрыт. */
export const authRequired = () => !!(process.env.VERCEL || process.env.GITHUB_CLIENT_ID);
export const authConfigured = () =>
  !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.ALLOWED_GITHUB_USERS);

export const allowedLogin = (login?: string | null) =>
  !!login &&
  (process.env.ALLOWED_GITHUB_USERS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .includes(login.toLowerCase());

export const baseURL = () =>
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:${process.env.PORT || 5055}`);

export const mcpResource = () => `${baseURL()}/mcp`;

/** Конфиг Better Auth — общий для сервера и генератора схемы (scripts/gen-auth-schema.ts). */
export const authOptions = (database?: BetterAuthOptions['database']) =>
  ({
    baseURL: baseURL(),
    // отдельный секрет не обязателен: выводим из секрета OAuth-приложения GitHub
    secret:
      process.env.BETTER_AUTH_SECRET ||
      createHash('sha256').update(`cashflow-auth:${process.env.GITHUB_CLIENT_SECRET}`).digest('hex'),
    database,
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID as string,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
        // пускаем только логины из ALLOWED_GITHUB_USERS; логин храним как имя пользователя
        mapProfileToUser: (profile) => {
          if (!allowedLogin(profile.login))
            throw new APIError('FORBIDDEN', { message: `Вход для ${profile.login} не разрешён` });
          return { name: profile.login };
        },
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: mcpResource(),
        // claude.ai и ChatGPT регистрируются сами (DCR); выдать токен всё равно можно только после входа и согласия
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  }) satisfies BetterAuthOptions;
