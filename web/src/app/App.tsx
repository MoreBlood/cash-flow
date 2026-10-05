import '@radix-ui/themes/styles.css';
import './app.css';
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
  BarChartIcon,
  CardStackIcon,
  ExitIcon,
  GearIcon,
  PieChartIcon,
} from '@radix-ui/react-icons';
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
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Cash Flow', Icon: BarChartIcon },
  { to: '/capital', label: 'Капитал', Icon: PieChartIcon },
  { to: '/banks', label: 'Банки', Icon: CardStackIcon },
];

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
    <Box className="top-bar">
      <Container size="4" px={{ initial: '3', sm: '4' }} py={{ initial: '2', sm: '3' }}>
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Heading size={{ initial: '4', sm: '6' }} style={{ whiteSpace: 'nowrap' }}>
            💸 Финансы
          </Heading>
          <Flex gap="3" align="center" wrap="wrap" minWidth="0">
            <SyncButton />
            {/* на телефоне разделы — в нижнем таб-баре */}
            <Box display={{ initial: 'none', sm: 'block' }}>
              <TabNav.Root>
                {NAV.map(({ to, label }) => (
                  <TabNav.Link key={to} asChild active={pathname === to}>
                    <Link to={to}>{label}</Link>
                  </TabNav.Link>
                ))}
              </TabNav.Root>
            </Box>
            <Select.Root size="2" value={base} onValueChange={(v) => setBase(v as BaseCurrency)}>
              <Select.Trigger variant="soft" radius="full" />
              <Select.Content>
                {BASE_CURRENCIES.map((c) => (
                  <Select.Item key={c} value={c}>
                    {c}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Flex gap="3" display={{ initial: 'none', sm: 'flex' }}>
              <IconButton
                size="2"
                variant={pathname === '/settings' ? 'solid' : 'soft'}
                color="gray"
                title="Настройки"
                onClick={() => navigate('/settings')}
              >
                <GearIcon />
              </IconButton>
              {setup?.auth && (
                <IconButton
                  size="2"
                  variant="soft"
                  color="gray"
                  title={`Выйти (${setup.login})`}
                  onClick={() => authClient.signOut().then(() => navigate('/sign-in'))}
                >
                  <ExitIcon />
                </IconButton>
              )}
            </Flex>
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}

/** Таб-бар внизу экрана на телефоне (на десктопе скрыт стилями). */
function BottomNav() {
  return (
    <nav className="bottom-nav">
      {[...NAV, { to: '/settings', label: 'Настройки', Icon: GearIcon }].map(
        ({ to, label, Icon }) => (
          <NavLink key={to} to={to} end>
            <Icon width={22} height={22} />
            {label}
          </NavLink>
        ),
      )}
    </nav>
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
                    <Box className="app-main">
                      <Routes>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/capital" element={<CapitalPage />} />
                        <Route path="/banks" element={<BanksPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                      </Routes>
                    </Box>
                    <BottomNav />
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
