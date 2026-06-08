import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'mercalito.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

export const ACTIVE_CHECK_FILTER = `
  excluded = 0
  AND (
    (
      source_type = 'physical'
      AND UPPER(TRIM(COALESCE(status, ''))) = 'EMITIDO'
    )
    OR (
      source_type = 'echeq'
      AND UPPER(TRIM(COALESCE(status, ''))) IN (
        'ACTIVO',
        'ACTIVO_PENDIENTE',
        'CUSTODIA',
        'EMITIDO_PENDIENTE'
      )
    )
  )
`;

export function isActiveCheck(row) {
  const status = String(row.status || '').trim().toUpperCase();
  if (row.source_type === 'physical') return status === 'EMITIDO';
  if (row.source_type === 'echeq') {
    return ['ACTIVO', 'ACTIVO_PENDIENTE', 'CUSTODIA', 'EMITIDO_PENDIENTE'].includes(status);
  }
  return false;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL,
    check_number TEXT,
    bank TEXT,
    supplier TEXT,
    cuit TEXT,
    status TEXT,
    source_file TEXT,
    raw_json TEXT,
    excluded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS day_cash (
    payment_date TEXT PRIMARY KEY,
    opening_balance REAL NOT NULL DEFAULT 0,
    cards_income REAL NOT NULL DEFAULT 0,
    mercado_pago_income REAL NOT NULL DEFAULT 0,
    cash_income REAL NOT NULL DEFAULT 0,
    transfer_income REAL NOT NULL DEFAULT 0,
    other_income REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const tableColumns = db.prepare(`PRAGMA table_info(checks)`).all().map((column) => column.name);
if (!tableColumns.includes('excluded')) {
  db.prepare(`ALTER TABLE checks ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`).run();
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const normalized = String(value)
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function localDate(daysToAdd = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysToAdd);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function shiftDate(dateText, daysToAdd) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

export function getDashboardRows(fromDate, days) {
  const today = localDate();
  const tomorrow = localDate(1);
  const rows = db
    .prepare(
      `
      WITH RECURSIVE dates(day, n) AS (
        SELECT date(?), 1
        UNION ALL
        SELECT date(day, '+1 day'), n + 1 FROM dates WHERE n < ?
      ),
      normalized_checks AS (
        SELECT
          CASE
            WHEN payment_date <= ? THEN ?
            ELSE payment_date
          END AS effective_payment_date,
          source_type,
          CASE
            WHEN TRIM(COALESCE(check_number, '')) = '' THEN 'id:' || id
            ELSE TRIM(check_number)
          END AS check_key,
          MAX(amount) AS amount
        FROM checks
        WHERE ${ACTIVE_CHECK_FILTER}
        GROUP BY effective_payment_date, source_type, check_key
      ),
      check_totals AS (
        SELECT
          effective_payment_date,
          SUM(amount) AS checks_total,
          COUNT(*) AS checks_count
        FROM normalized_checks
        GROUP BY effective_payment_date
      )
      SELECT
        dates.day AS payment_date,
        COALESCE(day_cash.opening_balance, 0) AS opening_balance,
        COALESCE(day_cash.cards_income, 0) AS cards_income,
        COALESCE(day_cash.mercado_pago_income, 0) AS mercado_pago_income,
        COALESCE(day_cash.cash_income, 0) AS cash_income,
        COALESCE(day_cash.transfer_income, 0) AS transfer_income,
        COALESCE(day_cash.other_income, 0) AS other_income,
        COALESCE(check_totals.checks_total, 0) AS checks_total,
        COALESCE(check_totals.checks_count, 0) AS checks_count
      FROM dates
      LEFT JOIN day_cash ON day_cash.payment_date = dates.day
      LEFT JOIN check_totals ON check_totals.effective_payment_date = dates.day
      ORDER BY dates.day ASC
      `
    )
    .all(fromDate, days, today, tomorrow);

  return rows.map((row) => {
    const estimated_income =
      row.cards_income +
      row.mercado_pago_income +
      row.cash_income +
      row.transfer_income +
      row.other_income;
    const difference = row.opening_balance + estimated_income - row.checks_total;
    const status = difference < 0 ? 'red' : difference <= 1000 ? 'yellow' : 'green';

    return {
      ...row,
      estimated_income,
      difference,
      status
    };
  });
}
