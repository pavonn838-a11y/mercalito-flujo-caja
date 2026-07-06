import XLSX from 'xlsx';
import fs from 'node:fs';
import { toNumber } from './db.js';

const headerAliases = {
  paymentDate: [
    'fecha de pago',
    'fecha pago',
    'dia de pago',
    'dia pago',
    'vencimiento',
    'fecha de vencimiento',
    'fecha vencimiento'
  ],
  amount: ['importe', 'monto', 'valor', 'total', 'importe cheque', 'importe echeq'],
  checkNumber: [
    'numero',
    'nro',
    'nro cheque',
    'nro de cheque',
    'nro. cheque',
    'numero cheque',
    'numero de cheque',
    'n° cheque',
    'n° de cheque',
    'cheque',
    'id cheque',
    'id echeq',
    'numero echeq',
    'numero de echeq',
    'n° echeq',
    'n° de echeq'
  ],
  bank: ['banco', 'entidad', 'banco girado'],
  supplier: ['proveedor', 'beneficiario', 'cliente', 'razon social', 'emisor', 'emitido a', 'librador'],
  cuit: ['cuit', 'cuil', 'documento'],
  status: ['estado', 'situacion']
};

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function findKey(row, aliases) {
  const normalizedEntries = Object.keys(row).map((key) => [key, normalizeHeader(key)]);
  const match = normalizedEntries.find(([, normalized]) => aliases.includes(normalized));
  return match?.[0];
}

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
}

export function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    return excelSerialToDate(value).toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const [, day, month, rawYear] = match;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? null : direct.toISOString().slice(0, 10);
}

export function detectSourceType(fileName, sheetName, rows, explicitType) {
  if (explicitType === 'echeq' || explicitType === 'physical') return explicitType;

  const text = `${fileName} ${sheetName} ${Object.keys(rows[0] || {}).join(' ')}`.toLowerCase();
  if (text.includes('emitido a')) return 'echeq';
  if (text.includes('echeq') || text.includes('e-cheq') || text.includes('ecq')) return 'echeq';
  if (text.includes('fisico') || text.includes('físico') || text.includes('cheque fisico')) return 'physical';
  return 'physical';
}

export function parseWorkbook(filePath, originalName, explicitType) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const sourceType = detectSourceType(originalName, sheetName, rows, explicitType);

  return rows
    .map((row) => {
      const paymentDateKey = findKey(row, headerAliases.paymentDate);
      const amountKey = findKey(row, headerAliases.amount);
      const paymentDate = normalizeDate(row[paymentDateKey]);
      const amount = toNumber(row[amountKey]);

      if (!paymentDate || amount <= 0) return null;

      return {
        source_type: sourceType,
        payment_date: paymentDate,
        amount,
        check_number: String(row[findKey(row, headerAliases.checkNumber)] || '').trim(),
        bank: String(row[findKey(row, headerAliases.bank)] || '').trim(),
        supplier: String(row[findKey(row, headerAliases.supplier)] || '').trim(),
        cuit: String(row[findKey(row, headerAliases.cuit)] || '').trim(),
        status: String(row[findKey(row, headerAliases.status)] || '').trim(),
        source_file: originalName,
        raw_json: JSON.stringify(row)
      };
    })
    .filter(Boolean);
}
