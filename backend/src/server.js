import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import XLSX from 'xlsx';
import { ACTIVE_CHECK_FILTER, db, getDashboardRows, isActiveCheck, localDate, toNumber } from './db.js';
import { parseWorkbook } from './excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || '0.0.0.0';
const upload = multer({ dest: path.join(os.tmpdir(), 'mercalito-uploads') });
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function requireLogin(req, res, next) {
  const configuredUser = process.env.APP_USER;
  const configuredPassword = process.env.APP_PASSWORD;

  if (!configuredUser || !configuredPassword) {
    next();
    return;
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, credentials] = authHeader.split(' ');
  if (scheme === 'Basic' && credentials) {
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (user === configuredUser && password === configuredPassword) {
      next();
      return;
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Mercalito"');
  res.status(401).send('Acceso protegido');
}

app.use(requireLogin);

app.post('/api/import', upload.array('files'), (req, res) => {
  const files = req.files || [];
  const explicitType = req.body.type;
  const insert = db.prepare(`
    INSERT INTO checks (
      source_type, payment_date, amount, check_number, bank, supplier, cuit, status, source_file, raw_json
    ) VALUES (
      @source_type, @payment_date, @amount, @check_number, @bank, @supplier, @cuit, @status, @source_file, @raw_json
    )
  `);

  const imported = [];
  const clearByType = db.prepare('DELETE FROM checks WHERE source_type = ?');
  function saveRows(rows) {
    db.exec('BEGIN');
    try {
      rows.forEach((row) => insert.run(row));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  try {
    if (explicitType === 'echeq' || explicitType === 'physical') {
      clearByType.run(explicitType);
    }

    for (const file of files) {
      const rows = parseWorkbook(file.path, file.originalname, explicitType).filter(isActiveCheck);
      saveRows(rows);
      imported.push({
        file: file.originalname,
        count: rows.length,
        type: rows[0]?.source_type || explicitType || 'physical'
      });
      fs.unlinkSync(file.path);
    }

    res.json({ imported, total: imported.reduce((sum, file) => sum + file.count, 0) });
  } catch (error) {
    files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });
    res.status(400).json({ error: 'No se pudo importar el Excel.', detail: error.message });
  }
});

app.get('/api/dashboard', (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const days = Math.min(Number(req.query.days || 30), 365);
  const rows = getDashboardRows(from, days);

  const ranges = [3, 7, 15, 30, 360].map((range) => {
    const slice = rows.slice(0, range);
    return {
      days: range,
      checks_total: slice.reduce((sum, row) => sum + row.checks_total, 0),
      income_total: slice.reduce((sum, row) => sum + row.estimated_income + row.opening_balance, 0),
      difference: slice.reduce((sum, row) => sum + row.difference, 0)
    };
  });

  res.json({ rows, ranges });
});

app.put('/api/days/:date', (req, res) => {
  const paymentDate = req.params.date;
  const values = {
    payment_date: paymentDate,
    opening_balance: toNumber(req.body.opening_balance),
    cards_income: toNumber(req.body.cards_income),
    mercado_pago_income: toNumber(req.body.mercado_pago_income),
    cash_income: toNumber(req.body.cash_income),
    transfer_income: toNumber(req.body.transfer_income),
    other_income: toNumber(req.body.other_income)
  };

  db.prepare(
    `
    INSERT INTO day_cash (
      payment_date, opening_balance, cards_income, mercado_pago_income, cash_income, transfer_income, other_income
    ) VALUES (
      @payment_date, @opening_balance, @cards_income, @mercado_pago_income, @cash_income, @transfer_income, @other_income
    )
    ON CONFLICT(payment_date) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      cards_income = excluded.cards_income,
      mercado_pago_income = excluded.mercado_pago_income,
      cash_income = excluded.cash_income,
      transfer_income = excluded.transfer_income,
      other_income = excluded.other_income,
      updated_at = CURRENT_TIMESTAMP
    `
  ).run(values);

  res.json({ ok: true, row: values });
});

app.get('/api/checks/summary', (_req, res) => {
  const loadedRows = db
    .prepare(
      `
      SELECT source_type, COUNT(*) AS count
      FROM checks
      GROUP BY source_type
      `
    )
    .all();
  const activeRows = db
    .prepare(
      `
      WITH normalized AS (
        SELECT
          source_type,
          CASE
            WHEN TRIM(COALESCE(check_number, '')) = '' THEN 'id:' || id
            ELSE TRIM(check_number)
          END AS check_key,
          MAX(amount) AS amount
        FROM checks
        WHERE ${ACTIVE_CHECK_FILTER}
        GROUP BY source_type, check_key
      )
      SELECT source_type, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM normalized
      GROUP BY source_type
      `
    )
    .all();
  const loadedFor = (type) => loadedRows.find((row) => row.source_type === type)?.count || 0;
  const activeFor = (type) => activeRows.find((row) => row.source_type === type) || { count: 0, total: 0 };

  res.json({
    echeq: loadedFor('echeq'),
    physical: loadedFor('physical'),
    active: {
      echeq: activeFor('echeq'),
      physical: activeFor('physical')
    }
  });
});

app.get('/api/checks', (req, res) => {
  const date = req.query.date;
  const today = localDate();
  const tomorrow = localDate(1);
  const rows = db
    .prepare(
      `
      SELECT
        MIN(id) AS id,
        source_type,
        payment_date,
        MAX(amount) AS amount,
        check_number,
        MAX(bank) AS bank,
        MAX(supplier) AS supplier,
        MAX(cuit) AS cuit,
        MAX(status) AS status,
        MAX(source_file) AS source_file,
        CASE WHEN payment_date <= ? THEN 1 ELSE 0 END AS is_overdue
      FROM checks
      WHERE (
        ? IS NULL
        OR payment_date = ?
        OR (? = ? AND payment_date <= ?)
      )
      AND ${ACTIVE_CHECK_FILTER}
      GROUP BY
        CASE
          WHEN TRIM(COALESCE(check_number, '')) = '' THEN 'id:' || id
          ELSE TRIM(check_number)
        END,
        source_type,
        CASE
          WHEN payment_date <= ? THEN ?
          ELSE payment_date
        END
      ORDER BY payment_date ASC, amount DESC
      `
    )
    .all(
      today,
      date || null,
      date || null,
      date || null,
      tomorrow,
      today,
      today,
      tomorrow
    );

  res.json({ rows });
});

app.get('/api/checks/by-supplier', (req, res) => {
  const query = String(req.query.q || '').trim();
  const today = localDate();

  if (query.length < 2) {
    res.json({ rows: [], total: 0, count: 0 });
    return;
  }

  const rows = db
    .prepare(
      `
      SELECT
        MIN(id) AS id,
        source_type,
        payment_date,
        MAX(amount) AS amount,
        check_number,
        MAX(bank) AS bank,
        MAX(supplier) AS supplier,
        MAX(cuit) AS cuit,
        MAX(status) AS status,
        MAX(source_file) AS source_file,
        CASE WHEN payment_date < ? THEN 1 ELSE 0 END AS is_overdue
      FROM checks
      WHERE ${ACTIVE_CHECK_FILTER}
        AND UPPER(COALESCE(supplier, '')) LIKE UPPER(?)
      GROUP BY
        source_type,
        CASE
          WHEN TRIM(COALESCE(check_number, '')) = '' THEN 'id:' || id
          ELSE TRIM(check_number)
        END
      ORDER BY payment_date ASC, amount DESC
      `
    )
    .all(today, `%${query}%`);

  res.json({
    rows,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    count: rows.length
  });
});

app.delete('/api/checks', (_req, res) => {
  const type = _req.query.type;
  if (type === 'echeq' || type === 'physical') {
    const result = db.prepare('DELETE FROM checks WHERE source_type = ?').run(type);
    res.json({ ok: true, deleted: result.changes, type });
    return;
  }

  const result = db.prepare('DELETE FROM checks').run();
  res.json({ ok: true, deleted: result.changes });
});

app.patch('/api/checks/:id/excluded', (req, res) => {
  const excluded = req.body.excluded ? 1 : 0;
  const result = db.prepare('UPDATE checks SET excluded = ? WHERE id = ?').run(excluded, req.params.id);
  res.json({ ok: true, changed: result.changes, excluded });
});

app.get('/api/export', (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const days = Math.min(Number(req.query.days || 30), 365);
  const rows = getDashboardRows(from, days).map((row) => ({
    'Dia de pago': row.payment_date,
    'Saldo inicial': row.opening_balance,
    Tarjetas: row.cards_income,
    'Mercado Pago': row.mercado_pago_income,
    Efectivo: row.cash_income,
    Transferencias: row.transfer_income,
    Otros: row.other_income,
    'Cheques a pagar': row.checks_total,
    'Cantidad cheques': row.checks_count,
    Diferencia: row.difference,
    Semaforo: row.status === 'green' ? 'Verde' : row.status === 'yellow' ? 'Amarillo' : 'Rojo'
  }));

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(rows);
  const checks = db
    .prepare(
      `
      SELECT
             CASE
               WHEN payment_date <= @today THEN @tomorrow
               ELSE payment_date
             END AS 'Dia de pago',
             payment_date AS 'Fecha original',
             CASE
               WHEN payment_date <= @today THEN 'Si'
               ELSE 'No'
             END AS 'Vencido arrastrado',
             source_type AS Tipo, MAX(amount) AS Importe, check_number AS Numero,
             MAX(bank) AS Banco, MAX(supplier) AS Proveedor, MAX(cuit) AS CUIT, MAX(status) AS Estado, MAX(source_file) AS Archivo
      FROM checks
      WHERE ${ACTIVE_CHECK_FILTER}
      GROUP BY
             "Dia de pago",
             payment_date,
             source_type,
             CASE
               WHEN TRIM(COALESCE(check_number, '')) = '' THEN 'id:' || id
               ELSE TRIM(check_number)
             END
      ORDER BY "Dia de pago" ASC, payment_date ASC
      `
    )
    .all({ today: localDate(), tomorrow: localDate(1) });

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Flujo diario');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(checks), 'Detalle cheques');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="mercalito-flujo-caja.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, host, () => {
  console.log(`Mercalito backend listo en http://${host}:${port}`);
});
