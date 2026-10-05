// Функция Vercel: всё API, вход, MCP и колбэк банка (маршруты — rewrites в vercel.json).
// Статика (собранный фронт) отдаётся CDN из public/.
import { handle } from 'hono/vercel';
import app from '../src/index.ts';

export const config = { maxDuration: 300 };
const h = handle(app);
export { h as DELETE, h as GET, h as HEAD, h as OPTIONS, h as PATCH, h as POST, h as PUT };
