import '@radix-ui/themes/styles.css';
import {
  BASE_CURRENCIES,
  type BaseCurrency,
  BaseCurrencyProvider,
  useBaseCurrency,
} from '@app/currency';
import { SyncButton } from '@features/sync/SyncButton';
import { ConsentPage } from '@pages/auth/ConsentPage';
import { SignInPage } from '@pages/auth/SignInPage';
import { BanksPage } from '@pages/banks/BanksPage';
import { CapitalPage } from '@pages/capital/CapitalPage';
import { DashboardPage } from '@pages/dashboard/DashboardPage';
import { SettingsPage } from '@pages/settings/SettingsPage';
import { SetupPage } from '@pages/setup/SetupPage';
import {
  Box,
  Container,
  Flex,
  Heading,
  IconButton,
  Select,
  Spinner,
  TabNav,
  Theme,
} from '@radix-ui/themes';
import { fetchSetup, type Setup } from '@shared/api/client';
import { authClient } from '@shared/auth/client';
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

function Nav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { base, setBase } = useBaseCurrency();
  const [setup, setSetup] = useState<Setup | null>(null);
  useEffect(() => {
    fetchSetup()
      .then(setSetup)
      .catch(() => {});
  }, []);
  return (
    <Box style={{ borderBottom: '1px solid var(--gray-4)' }}>
      <Container size="4" px={{ initial: '3', sm: '4' }} py="3">
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Heading size={{ initial: '5', sm: '6' }}>💸 Финансы</Heading>
          <Flex gap="3" align="center" wrap="wrap">
            <SyncButton />
            <TabNav.Root>
              <TabNav.Link asChild active={pathname === '/'}>
                <Link to="/">Cash Flow</Link>
              </TabNav.Link>
              <TabNav.Link asChild active={pathname === '/capital'}>
                <Link to="/capital">Капитал</Link>
              </TabNav.Link>
              <TabNav.Link asChild active={pathname === '/banks'}>
                <Link to="/banks">Банки</Link>
              </TabNav.Link>
            </TabNav.Root>
            <Select.Root size="2" value={base} onValueChange={(v) => setBase(v as BaseCurrency)}>
              <Select.Trigger variant="soft" />
              <Select.Content>
                {BASE_CURRENCIES.map((c) => (
                  <Select.Item key={c} value={c}>
                    {c}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <IconButton
              size="2"
              variant={pathname === '/settings' ? 'solid' : 'soft'}
              color="gray"
              title="Настройки"
              onClick={() => navigate('/settings')}
            >
              ⚙
            </IconButton>
            {setup?.auth && (
              <IconButton
                size="2"
                variant="soft"
                color="gray"
                title={`Выйти (${setup.login})`}
                onClick={() => authClient.signOut().then(() => navigate('/sign-in'))}
              >
                ⎋
              </IconButton>
            )}
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}

/** Новая облачная установка без настроенного входа — показываем мастер настройки. */
function SetupGate({ children }: { children: React.ReactNode }) {
  const [setup, setSetup] = useState<Setup | null | undefined>(undefined);
  useEffect(() => {
    fetchSetup()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);
  if (setup === undefined)
    return (
      <Flex justify="center" align="center" style={{ minHeight: '60vh' }}>
        <Spinner size="3" />
      </Flex>
    );
  if (setup && !setup.authConfigured) return <SetupPage setup={setup} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Theme appearance="dark" accentColor="iris" grayColor="slate" radius="large">
      <BaseCurrencyProvider>
        <BrowserRouter>
          <SetupGate>
            <Routes>
              {/* вход и согласие (облачная установка) — без шапки */}
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/consent" element={<ConsentPage />} />
              <Route
                path="*"
                element={
                  <>
                    <Nav />
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/capital" element={<CapitalPage />} />
                      <Route path="/banks" element={<BanksPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </>
                }
              />
            </Routes>
          </SetupGate>
        </BrowserRouter>
      </BaseCurrencyProvider>
    </Theme>
  );
}
