// Клиент Better Auth (облачная установка): вход через GitHub, согласие для MCP-коннекторов.
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
