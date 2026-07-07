import { setDisplayCurrency } from '@shared/lib/format';
import { createContext, type ReactNode, useContext, useState } from 'react';

export type BaseCurrency = 'PLN' | 'USD' | 'EUR' | 'CHF';
export const BASE_CURRENCIES: BaseCurrency[] = ['PLN', 'USD', 'EUR', 'CHF'];

const Ctx = createContext<{ base: BaseCurrency; setBase: (b: BaseCurrency) => void }>({
  base: 'PLN',
  setBase: () => {},
});

export function BaseCurrencyProvider({ children }: { children: ReactNode }) {
  const [base, setBaseState] = useState<BaseCurrency>(() => {
    const saved = localStorage.getItem('baseCurrency') as BaseCurrency | null;
    return saved && BASE_CURRENCIES.includes(saved) ? saved : 'PLN';
  });
  setDisplayCurrency(base); // до рендера детей, чтобы форматтеры были в нужной валюте
  const setBase = (b: BaseCurrency) => {
    localStorage.setItem('baseCurrency', b);
    setDisplayCurrency(b);
    setBaseState(b);
  };
  return <Ctx.Provider value={{ base, setBase }}>{children}</Ctx.Provider>;
}

export const useBaseCurrency = () => useContext(Ctx);
