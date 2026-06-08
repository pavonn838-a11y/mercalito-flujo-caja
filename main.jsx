import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const DASHBOARD_DAYS = 360;
const moneyFields = [
  ['opening_balance', 'Saldo banco'],
  ['cards_income', 'Tarjetas'],
  ['mercado_pago_income', 'Mercado Pago'],
  ['cash_income', 'Efectivo'],
  ['transfer_income', 'Transferencias'],
  ['other_income', 'Otros']
];

const statusText = {
  green: 'Verde',
  yellow: 'Justo',
  red: 'Falta'
};

function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value || 0);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  }).format(new Date(`${date}T12:00:00`));
}

function App() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [dashboard, setDashboard] = useState({ rows: [], ranges: [] });
  const [selectedDate, setSelectedDate] = useState(today);
  const [checks, setChecks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [loadSummary, setLoadSummary] = useState({
    echeq: 0,
    physical: 0,
    active: {
      echeq: { count: 0, total: 0 },
      physical: { count: 0, total: 0 }
    }
  });

  async function loadDashboard() {
    const response = await fetch(`${API_URL}/api/dashboard?from=${fromDate}&days=${DASHBOARD_DAYS}`);
    const data = await response.json();
    setDashboard(data);
    if (!data.rows.some((row) => row.payment_date === selectedDate)) {
      setSelectedDate(data.rows[0]?.payment_date || fromDate);
    }
  }

  async function loadChecks(date = selectedDate) {
    const response = await fetch(`${API_URL}/api/checks?date=${date}`);
    const data = await response.json();
    setChecks(data.rows);
  }

  async function loadCheckSummary() {
    const response = await fetch(`${API_URL}/api/checks/summary`);
    const data = await response.json();
    setLoadSummary(data);
  }

  useEffect(() => {
    loadDashboard();
    loadCheckSummary();
  }, [fromDate]);

  useEffect(() => {
    loadChecks(selectedDate);
  }, [selectedDate]);

  const selectedDay = useMemo(
    () => dashboard.rows.find((row) => row.payment_date === selectedDate),
    [dashboard.rows, selectedDate]
  );

  const filteredChecks = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return checks;
    return checks.filter((check) =>
      [check.source_type, check.check_number, check.bank, check.supplier, check.cuit, check.source_file]
        .join(' ')
        .toLowerCase()
        .includes(value)
    );
  }, [checks, search]);

  async function importFiles(event, type) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setUploading(true);
    setMessage('');

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    formData.append('type', type);

    try {
      const response = await fetch(`${API_URL}/api/import`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error);
      setMessage(`Se importaron ${data.total} cheques correctamente.`);
      await loadDashboard();
      await loadCheckSummary();
      await loadChecks(selectedDate);
    } catch (error) {
      setMessage(`No se pudo importar: ${error.message}`);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function saveDay(date, patch) {
    const current = dashboard.rows.find((row) => row.payment_date === date);
    const payload = Object.fromEntries(moneyFields.map(([key]) => [key, current?.[key] || 0]));
    Object.assign(payload, patch);

    await fetch(`${API_URL}/api/days/${date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await loadDashboard();
  }

  async function clearChecks(type) {
    const label = type === 'echeq' ? 'eCheq' : 'cheques fisicos';
    const confirmed = window.confirm(`Esto borra solo ${label}, pero conserva saldos e ingresos cargados. ¿Continuar?`);
    if (!confirmed) return;
    try {
      const response = await fetch(`${API_URL}/api/checks?type=${type}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo limpiar la carga.');
      setMessage(`Se limpiaron ${data.deleted || 0} registros de ${label}.`);
      await loadDashboard();
      await loadCheckSummary();
      await loadChecks(selectedDate);
    } catch (error) {
      setMessage(`No se pudo limpiar ${label}: ${error.message}`);
    }
  }

  function updateLocalDay(date, key, value) {
    setDashboard((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.payment_date === date ? { ...row, [key]: Number(value) || 0 } : row
      )
    }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mercalito</p>
          <h1>Flujo de caja diario</h1>
        </div>
        <div className="top-actions">
          <label className="date-control">
            <CalendarDays size={16} />
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <button className="ghost-button" onClick={loadDashboard}>
            <RefreshCw size={17} />
            Actualizar
          </button>
        </div>
      </header>

      <section className="import-band">
        <div className="import-tile">
          <FileSpreadsheet size={22} />
          <div>
            <strong>eCheq</strong>
            <span>{loadSummary.echeq} cargados</span>
            <small>{formatMoney(loadSummary.active?.echeq?.total)} emitidos</small>
          </div>
          <label className="primary-button">
            <Upload size={17} />
            Subir
            <input type="file" accept=".xls,.xlsx" multiple onChange={(event) => importFiles(event, 'echeq')} />
          </label>
        </div>
        <div className="import-tile">
          <FileSpreadsheet size={22} />
          <div>
            <strong>Cheques fisicos</strong>
            <span>{loadSummary.physical} cargados</span>
            <small>{formatMoney(loadSummary.active?.physical?.total)} emitidos</small>
          </div>
          <label className="primary-button">
            <Upload size={17} />
            Subir
            <input type="file" accept=".xls,.xlsx" multiple onChange={(event) => importFiles(event, 'physical')} />
          </label>
        </div>
        <a className="ghost-button export-link" href={`${API_URL}/api/export?from=${fromDate}&days=${DASHBOARD_DAYS}`}>
          <Download size={17} />
          Exportar
        </a>
        <button className="danger-button" onClick={() => clearChecks('echeq')}>
          <Trash2 size={17} />
          Limpiar eCheq
        </button>
        <button className="danger-button" onClick={() => clearChecks('physical')}>
          <Trash2 size={17} />
          Limpiar cheques
        </button>
      </section>

      {(message || uploading) && <div className="notice">{uploading ? 'Importando archivos...' : message}</div>}

      <section className="type-total-grid">
        <article className="type-total-card">
          <span>Total cheques emitidos</span>
          <strong>{formatMoney(loadSummary.active?.physical?.total)}</strong>
          <small>{loadSummary.active?.physical?.count || 0} emitidos</small>
        </article>
        <article className="type-total-card">
          <span>Total eCheq emitidos</span>
          <strong>{formatMoney(loadSummary.active?.echeq?.total)}</strong>
          <small>{loadSummary.active?.echeq?.count || 0} emitidos</small>
        </article>
      </section>

      <section className="summary-grid">
        {dashboard.ranges.map((range) => (
          <article className="summary-card" key={range.days}>
            <span>Proximos {range.days} dias</span>
            <strong className={range.difference < 0 ? 'negative' : 'positive'}>
              {formatMoney(range.difference)}
            </strong>
            <small>Cheques: {formatMoney(range.checks_total)}</small>
          </article>
        ))}
      </section>

      <section className="workspace">
        <div className="daily-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pantalla principal</p>
              <h2>Vencimientos por dia de pago</h2>
            </div>
            <Banknote size={24} />
          </div>

          <div className="day-list">
            {dashboard.rows.map((row) => (
              <button
                className={`day-row ${row.status} ${row.payment_date === selectedDate ? 'active' : ''}`}
                key={row.payment_date}
                onClick={() => setSelectedDate(row.payment_date)}
              >
                <div className="status-dot" aria-label={statusText[row.status]} />
                <div className="date-cell">
                  <strong>{formatDate(row.payment_date)}</strong>
                  <span>{row.checks_count} cheques</span>
                </div>
                <div className="money-cell">
                  <span>Cheques</span>
                  <strong>{formatMoney(row.checks_total)}</strong>
                </div>
                <div className="money-cell">
                  <span>Diferencia</span>
                  <strong>{formatMoney(row.difference)}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>

        <aside className="detail-panel">
          {selectedDay ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Dia de pago: {formatDate(selectedDay.payment_date)}</p>
                  <h2>{statusText[selectedDay.status]}: {formatMoney(selectedDay.difference)}</h2>
                </div>
                {selectedDay.status === 'red' && <AlertTriangle className="warning-icon" />}
              </div>

              <div className="inputs-grid">
                {moneyFields.map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      value={selectedDay[key] || ''}
                      onChange={(event) => updateLocalDay(selectedDay.payment_date, key, event.target.value)}
                      onBlur={(event) => saveDay(selectedDay.payment_date, { [key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>

              <div className="totals-strip">
                <div>
                  <span>Ingresos + saldo</span>
                  <strong>{formatMoney(selectedDay.estimated_income + selectedDay.opening_balance)}</strong>
                </div>
                <div>
                  <span>Cheques a pagar</span>
                  <strong>{formatMoney(selectedDay.checks_total)}</strong>
                </div>
              </div>

              <div className="checks-heading">
                <h3>Detalle por numero</h3>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    type="search"
                    placeholder="Buscar"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>

              <div className="checks-list">
                {filteredChecks.length ? (
                  filteredChecks.map((check) => (
                    <article className="check-card" key={check.id}>
                      <div>
                        <strong>
                          Nro {check.source_type === 'echeq' ? 'eCheq' : 'cheque'}: {check.check_number || 'sin numero'}
                        </strong>
                        <span className="check-number">
                          {check.source_type === 'echeq' ? 'eCheq' : 'Cheque fisico'} · Dia de pago {formatDate(check.payment_date)}
                        </span>
                        <span>
                          {check.supplier || check.bank || check.source_file}
                          {check.is_overdue ? ' · pasa a manana' : ''}
                        </span>
                      </div>
                      <div className="check-actions">
                        <strong>{formatMoney(check.amount)}</strong>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No hay cheques para esta fecha.</p>
                )}
              </div>
            </>
          ) : (
            <p className="empty-state">Selecciona una fecha para ver el detalle.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
