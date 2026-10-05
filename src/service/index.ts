// Все операции сервиса в одном месте — их зовут HTTP-API (дашборд) и MCP (агенты).
import type { Db } from '../db/index.ts';
import { eb, type Psu } from '../lib/eb.ts';
import type { Currency } from '../lib/fx.ts';
import * as catalog from './catalog.ts';
import * as ebSettings from './eb-settings.ts';
import * as ledger from './ledger.ts';
import * as sync from './sync.ts';
import * as transfer from './transfer.ts';

export function createService(db: Db, opts: { onSyncDone?: (s: sync.SyncState) => unknown } = {}) {
  // ключ Enable Banking мог быть сохранён через UI (в облаке — другим инстансом): подтягиваем перед походом в банк
  const withEb = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => {
    await ebSettings.loadEbCredentials(db);
    return fn(...a);
  };
  return {
    // аналитика
    summary: (from: string, to: string, base: Currency) => ledger.summary(db, from, to, base),
    transactions: (from: string, to: string, base: Currency, o?: { accountId?: string; limit?: number }) =>
      ledger.transactionsFeed(db, from, to, base, o),
    meta: () => ledger.meta(db),
    balances: (base: Currency) => ledger.balances(db, base),
    networthHistory: (base: Currency) => ledger.networthHistory(db, base),

    // справочники
    settings: () => catalog.getSettings(db),
    saveSettings: (patch: Partial<catalog.Settings>) => catalog.saveSettings(db, patch),
    accounts: () => catalog.accountsList(db),
    categories: () => catalog.listCategories(db),
    createCategory: (b: Parameters<typeof catalog.createCategory>[1]) =>
      db.transaction((tx) => catalog.createCategory(tx, b)),
    renameCategory: (b: Parameters<typeof catalog.renameCategory>[1]) => catalog.renameCategory(db, b),
    deleteCategory: (b: Parameters<typeof catalog.deleteCategory>[1]) =>
      db.transaction((tx) => catalog.deleteCategory(tx, b)),
    rules: () => catalog.listRules(db),
    saveRule: (b: Parameters<typeof catalog.saveRule>[1]) => catalog.saveRule(db, b),
    deleteRule: (id?: string) => catalog.deleteRule(db, id),
    applyRules: () => db.transaction((tx) => catalog.applyRules(tx)),

    // правка операций
    categorize: (b: ledger.CategorizeInput) => db.transaction((tx) => ledger.categorize(tx, b)),
    exclude: (txId?: string) => ledger.excludeTx(db, txId),
    addOperation: (b: Parameters<typeof ledger.addOperation>[1]) => ledger.addOperation(db, b),
    addTransfer: (b: Parameters<typeof ledger.addTransfer>[1]) => ledger.addTransfer(db, b),
    updateTransaction: (b: Parameters<typeof ledger.updateTransaction>[1]) => ledger.updateTransaction(db, b),
    deleteTransaction: (id?: string) => ledger.deleteTransaction(db, id),

    // банки
    bankSync: withEb((psu?: Psu, accountIds?: string[]) =>
      sync.runBankSync(db, { psu, accountIds, onDone: opts.onSyncDone }),
    ),
    scheduledSync: withEb(() => sync.scheduledSync(db, opts.onSyncDone)),
    syncStatus: async () => ({
      ...(await sync.syncState(db)),
      syncing: await sync.isSyncing(db),
      expiring: await sync.expiringConsents(db),
      linked: await sync.linkedAccounts(db),
    }),
    banks: () => sync.banksView(db),
    aspsps: withEb(async (country: string = 'PL') =>
      (await eb.aspsps(country)).aspsps.map((b) => ({
        name: b.name,
        country: b.country,
        maxConsentDays: Math.floor((b.maximum_consent_validity || 0) / 86400),
      })),
    ),
    startConnect: withEb((b: Parameters<typeof sync.startConnect>[1]) => sync.startConnect(db, b)),
    completeConnect: withEb((q: Parameters<typeof sync.completeConnect>[1]) => sync.completeConnect(db, q)),

    // ключ Enable Banking через UI
    loadEb: () => ebSettings.loadEbCredentials(db),
    ebStatus: (redirectUrl: string) => ebSettings.ebStatus(db, redirectUrl),
    saveEb: (b: Parameters<typeof ebSettings.saveEbCredentials>[1]) => ebSettings.saveEbCredentials(db, b),
    deleteEb: () => ebSettings.deleteEbCredentials(db),

    // перенос данных между установками
    exportData: () => transfer.exportData(db),
    importData: (d: Parameters<typeof transfer.importData>[1]) => transfer.importData(db, d),
  };
}

export type Service = ReturnType<typeof createService>;
