
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Download, Printer, FileText } from 'lucide-react';
import './ReportsCentre.css';

type ReportRow = Record<string, unknown>;

type ReportResult = {
  report: string;
  from: string;
  to: string;
  timezone: string;
  columns: string[];
  rows: ReportRow[];
};

type Props = {
  token: string;
  onUnauthorized: () => void;
};

const reports = [
  { id: 'sales', label: 'Sales Register' },
  { id: 'gst', label: 'GST Summary' },
  { id: 'purchases', label: 'Purchase Register' },
  { id: 'stock', label: 'Stock Summary' },
  { id: 'ledger', label: 'Stock Movement Ledger' },
  { id: 'production', label: 'Production and Costing' },
  { id: 'materials', label: 'Material Consumption and Damage' },
  { id: 'collections', label: 'Payment Collections' },
  { id: 'receivables', label: 'Receivables and Ageing' },
  { id: 'audit', label: 'Audit Trail' }
];

function dateDefaults() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  return {
    from: `${today.slice(0, 7)}-01`,
    to: today
  };
}

function heading(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function cellValue(value: unknown) {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return new Date(value).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata'
    });
  }

  return String(value);
}

export default function ReportsCentre({
  token,
  onUnauthorized
}: Props) {
  const [from, setFrom] = useState(
    () => dateDefaults().from
  );

  const [to, setTo] = useState(
    () => dateDefaults().to
  );

  const [type, setType] = useState('sales');
  const [result, setResult] =
    useState<ReportResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function request(
    report: string,
    start: string,
    end: string,
    format: 'json' | 'csv'
  ) {
    const params = new URLSearchParams({
      from: start,
      to: end,
      format
    });

    const response = await fetch(
      `/api/reports/monthly/${report}?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (response.status === 401) {
      onUnauthorized();
      throw new Error('Session expired.');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);

      throw new Error(
        body?.error ?? `Request failed (${response.status})`
      );
    }

    return response;
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setError('');
    setResult(null);

    if (!from || !to || from > to) {
      setError('Select a valid reporting date range.');
      return;
    }

    setLoading(true);

    try {
      const response = await request(
        type, from, to, 'json'
      );

      const data: ReportResult = await response.json();
      setResult(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Report failed.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function downloadCsv() {
    if (!result) return;

    setError('');
    setExporting(true);

    try {
      const response = await request(
        result.report,
        result.from,
        result.to,
        'csv'
      );

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = url;
      link.download =
        `${result.report}-${result.from}-${result.to}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(
        () => URL.revokeObjectURL(url),
        1000
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Export failed.'
      );
    } finally {
      setExporting(false);
    }
  }

  const reportName = reports.find(
    report => report.id === result?.report
  )?.label;

  const filtersChanged = result !== null && (
    result.report !== type ||
    result.from !== from ||
    result.to !== to
  );

  return (
    <section className="reports-centre">
      <header className="reports-header">
        <FileText size={30} />

        <div>
          <h2>Reports &amp; Audit Centre</h2>

          <p>
            Financial, inventory and operational reports.
          </p>
        </div>
      </header>

      <form
        className="report-filters"
        onSubmit={generate}
      >
        <div className="report-field">
          <label htmlFor="report-type">Report type</label>

          <select
            id="report-type"
            value={type}
            disabled={loading}
            onChange={e => setType(e.target.value)}
          >
            {reports.map(report => (
              <option key={report.id} value={report.id}>
                {report.label}
              </option>
            ))}
          </select>
        </div>

        <div className="report-field">
          <label htmlFor="report-from">From date</label>

          <input
            id="report-from"
            type="date"
            required
            disabled={loading}
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </div>

        <div className="report-field">
          <label htmlFor="report-to">To date</label>

          <input
            id="report-to"
            type="date"
            required
            disabled={loading}
            value={to}
            min={from}
            onChange={e => setTo(e.target.value)}
          />
        </div>

        <button className="primary" disabled={loading}>
          {loading ? 'Generating…' : 'Generate Report'}
        </button>
      </form>

      {type === 'receivables' && (
        <p className="report-note">
          Receivables are calculated as of the selected
          end date. Ageing is based on invoice date,
          not payment due date.
        </p>
      )}

      {error && (
        <p className="error" role="alert">{error}</p>
      )}

      {!result && !loading && !error && (
        <p className="report-empty">
          Select a report and date range to begin.
        </p>
      )}

      {result && (
        <article className="report-result">
          <div className="report-toolbar">
            <div>
              <h3>{reportName}</h3>

              <p>
                {result.from} to {result.to}
                {' · '}{result.rows.length} records
                {' · IST'}
              </p>
            </div>

            <div className="report-actions">
              <button
                type="button"
                disabled={exporting || filtersChanged}
                onClick={downloadCsv}
              >
                <Download size={16} />
                {exporting ? 'Downloading…' : 'Export CSV'}
              </button>

              <button
                type="button"
                disabled={filtersChanged}
                onClick={() => window.print()}
              >
                <Printer size={16} />
                Print / Save PDF
              </button>
            </div>
          </div>

          {filtersChanged && (
            <p className="report-note">
              Filters have changed. Generate the report
              again before exporting.
            </p>
          )}

          {result.report === 'receivables' && (
            <p className="report-note">
              Outstanding balances as of {result.to}.
            </p>
          )}

          {result.rows.length === 0 ? (
            <p className="report-empty">
              No records found for this reporting period.
            </p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {result.columns.map(column => (
                      <th key={column}>
                        {heading(column)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index}>
                      {result.columns.map(column => (
                        <td key={column}>
                          {cellValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="report-footer">
            Order to Audit System · Reporting timezone:
            {' '}{result.timezone}
          </p>
        </article>
      )}
    </section>
  );
}
