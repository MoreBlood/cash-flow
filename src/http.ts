// HTTP: API дашборда, вход и OAuth для MCP (облако), MCP, колбэк банка, cron. Общий для локального сервера и Vercel.
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { requireMcpAuth } from '@better-auth/mcp';
import { type Context, Hono, type Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type Auth, allowedLogin, authConfigured, authRequired, baseURL, mcpResource } from './auth.ts';
import { ebConfigured } from './lib/eb.ts';
import { BASES, type Currency } from './lib/fx.ts';
import { createMcp } from './mcp.ts';
import type { Service } from './service/index.ts';
import { DATE } from './service/ledger.ts';

export type Env = { Variables: { login: string | null } };

export function createApp({ service, auth, publicUrl = '' }: { service: Service; auth: Auth | null; publicUrl?: string }) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    // у ошибок драйвера (DrizzleQueryError) суть — в cause; текст запроса с параметрами наружу не отдаём
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    const message = cause?.message ? `${cause.code ? `${cause.code}: ` : ''}${cause.message}` : String(err.message || err);
    return c.json({ error: message }, 500);
  });

  // --- вход (Better Auth) и OAuth-метаданные для MCP-коннекторов ------------------
  if (auth) {
    const asMetadata = oauthProviderAuthServerMetadata(auth);
    const oidcMetadata = oauthProviderOpenIdConfigMetadata(auth);
    app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*'])
      app.get(p, (c) => asMetadata(c.req.raw));
    for (const p of ['/.well-known/openid-configuration', '/.well-known/openid-configuration/*'])
      app.get(p, (c) => oidcMetadata(c.req.raw));
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'])
      app.get(p, (c) => auth.handler(c.req.raw));
  }

  /** Облако: только вошедший через GitHub владелец. Локально (127.0.0.1) — без входа. */
  const session = async (c: Context<Env>) => {
    if (!authRequired()) return { login: null };
    if (!auth || !authConfigured()) throw new HTTPException(503, { message: 'Вход не настроен: нужны GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ALLOWED_GITHUB_USERS' });
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    return s && allowedLogin(s.user.name) ? { login: s.user.name } : null;
  };
  const guard = async (c: Context<Env>, next: Next) => {
    const s = await session(c);
    if (!s) throw new HTTPException(401, { message: 'unauthorized' });
    c.set('login', s.login);
    await next();
  };

  // cron Vercel: без сессии, но синк не чаще раза в 12 часов (и с CRON_SECRET, если он задан)
  app.get('/api/cron/sync', async (c) => {
    const secret = process.env.CRON_SECRET;
    if (secret && c.req.header('authorization') !== `Bearer ${secret}`) throw new HTTPException(401, { message: 'unauthorized' });
    return c.json(await service.scheduledSync());
  });

  // --- MCP: в облаке — OAuth-токен Better Auth, локально — без входа ----------------
  const mcp = createMcp(service);
  const mcpProtected = auth ? requireMcpAuth(auth, (req) => mcp.fetch(req), { resource: mcpResource() }) : null;
  app.all('/mcp', (c) => {
    if (mcpProtected) return mcpProtected(c.req.raw);
    if (authRequired()) throw new HTTPException(503, { message: 'Вход не настроен' });
    return mcp.fetch(c.req.raw);
  });

  // --- колбэк банка → привязка счетов → синк → назад на «Банки» -----------------------
  const psuOf = (c: Context) => ({
    ip: (c.req.header('x-forwarded-for')?.split(',')[0] || c.req.header('x-real-ip') || '127.0.0.1').trim(),
    userAgent: c.req.header('user-agent'),
  });
  // redirect URL, зарегистрированный в приложении Enable Banking
  const redirectUrl = () =>
    process.env.EB_REDIRECT_URL ||
    (process.env.VERCEL ? `${baseURL()}/enablebanking/auth_callback` : 'https://localhost:5443/enablebanking/auth_callback');

  app.get('/enablebanking/auth_callback', async (c) => {
    if (!(await session(c))) return c.redirect('/sign-in');
    const back = (params: Record<string, string>) => c.redirect(`${publicUrl}/banks?${new URLSearchParams(params)}`);
    const q = c.req.query();
    if (q.error) return back({ error: q.error_description || q.error });
    try {
      const r = await service.completeConnect({ code: q.code, state: q.state });
      await service.bankSync(psuOf(c), r.accountIds).catch(() => {});
      return back({ linked: [...r.linked, ...r.created].join(', '), until: r.validUntil ?? '' });
    } catch (e) {
      console.error('[connect]', e);
      return back({ error: String((e as Error).message || e) });
    }
  });

  // состояние установки — открыто без входа (секретов нет): по нему фронт показывает мастер настройки
  app.get('/api/setup', async (c) => {
    const s = authRequired() && auth && authConfigured() ? await session(c).catch(() => null) : null;
    await service.loadEb().catch(() => {});
    return c.json({
      auth: authRequired(),
      authConfigured: !authRequired() || authConfigured(),
      login: s?.login ?? null,
      eb: ebConfigured(),
      redirectUrl: redirectUrl(),
      mcpUrl: mcpResource(),
      baseUrl: baseURL(),
      githubCallbackUrl: `${baseURL()}/api/auth/callback/github`,
    });
  });

  // --- API дашборда ------------------------------------------------------------------
  const api = new Hono<Env>();
  api.use(guard);

  const period = (c: Context) => {
    const { from, to } = c.req.query();
    if (!DATE.test(from || '') || !DATE.test(to || '')) throw new HTTPException(400, { message: 'from/to must be YYYY-MM-DD' });
    return [from, to] as const;
  };
  const base = (c: Context): Currency => {
    const b = (c.req.query('base') || 'PLN').toUpperCase();
    if (!(BASES as readonly string[]).includes(b)) throw new HTTPException(400, { message: 'base must be PLN|EUR|USD|CHF' });
    return b as Currency;
  };
  // biome-ignore lint/suspicious/noExplicitAny: тело проверяет сервис
  const body = async (c: Context): Promise<any> => {
    try {
      return await c.req.json();
    } catch {
      throw new HTTPException(400, { message: 'invalid JSON' });
    }
  };

  api.get('/summary', async (c) => c.json(await service.summary(...period(c), base(c))));
  api.get('/transactions', async (c) => {
    const limit = Number(c.req.query('limit'));
    return c.json(
      await service.transactions(...period(c), base(c), {
        accountId: c.req.query('account') || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
      }),
    );
  });
  api.get('/meta', async (c) => c.json(await service.meta()));
  api.get('/balances', async (c) => c.json(await service.balances(base(c))));
  api.get('/networth-history', async (c) => c.json(await service.networthHistory(base(c))));

  api.get('/accounts', async (c) => c.json(await service.accounts()));
  api.get('/settings', async (c) => c.json(await service.settings()));
  api.post('/settings', async (c) => c.json(await service.saveSettings(await body(c))));
  api.get('/categories', async (c) => c.json(await service.categories()));
  api.post('/categories', async (c) => c.json(await service.createCategory(await body(c))));
  api.post('/categories/rename', async (c) => c.json(await service.renameCategory(await body(c))));
  api.post('/categories/delete', async (c) => c.json(await service.deleteCategory(await body(c))));
  api.get('/rules', async (c) => c.json(await service.rules()));
  api.post('/rules', async (c) => c.json(await service.saveRule(await body(c))));
  api.post('/rules/delete', async (c) => c.json(await service.deleteRule((await body(c)).id)));
  api.post('/rules/apply', async (c) => c.json(await service.applyRules()));

  api.post('/categorize', async (c) => c.json(await service.categorize(await body(c))));
  api.post('/exclude', async (c) => c.json(await service.exclude((await body(c)).txId)));
  api.post('/operation', async (c) => c.json(await service.addOperation(await body(c))));
  api.post('/transfer', async (c) => c.json(await service.addTransfer(await body(c))));
  api.post('/transaction/update', async (c) => c.json(await service.updateTransaction(await body(c))));
  api.post('/transaction/delete', async (c) => c.json(await service.deleteTransaction((await body(c)).id)));

  api.get('/eb', async (c) => c.json(await service.ebStatus(redirectUrl())));
  api.post('/eb', async (c) => {
    await service.saveEb(await body(c));
    return c.json(await service.ebStatus(redirectUrl()));
  });
  api.post('/eb/delete', async (c) => {
    await service.deleteEb();
    return c.json(await service.ebStatus(redirectUrl()));
  });

  api.get('/export', async (c) => {
    c.header('Content-Disposition', `attachment; filename="cashflow-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(await service.exportData());
  });
  api.post('/import', async (c) => c.json(await service.importData(await body(c))));

  api.get('/sync-status', async (c) => c.json(await service.syncStatus()));
  api.post('/bank-sync', async (c) => c.json(await service.bankSync(psuOf(c))));
  api.get('/banks', async (c) => c.json(await service.banks()));
  api.get('/banks/aspsps', async (c) => c.json(await service.aspsps(c.req.query('country') || 'PL')));
  api.post('/banks/connect', async (c) => {
    const b = await body(c);
    if (!b.aspsp) throw new HTTPException(400, { message: 'need aspsp' });
    return c.json(await service.startConnect({ ...b, redirectUrl: redirectUrl() }));
  });

  app.route('/api', api);
  return app;
}
