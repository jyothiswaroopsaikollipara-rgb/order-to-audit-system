
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import {
  RefreshCw,
  ShoppingCart,
  Receipt,
  Package,
  Factory,
  Wallet,
  TrendingUp,
  Calculator,
  AlertTriangle
} from 'lucide-react';

import './BusinessDashboard.css';

type Props = {
  token: string;
  role: string;
  onUnauthorized: () => void;
};

type OrderSummary = {
  total_orders: number;
  today_orders: number;
  submitted: number;
  approved: number;
  invoiced: number;
  dispatched: number;
  rejected: number;
};

type SalesSummary = {
  invoice_count: number;
  taxable_sales: string;
  invoiced_sales: string;
  today_sales: string;
};

type CustomerSale = {
  customer_id: string;
  customer: string;
  invoices: number;
  quantity: string;
  taxable_sales: string;
  invoice_total: string;
};

type ProductSale = {
  item_id: string;
  product: string;
  unit: string;
  invoices: number;
  quantity: string;
  taxable_sales: string;
  invoice_total: string;
};

type StockItem = {
  item_id: string;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  quantity: string;
};

type ProductionRun = {
  id: string;
  created_at: string;
  product: string;
  expected_output: string;
  good_output: string;
  yield_pct: string;
  yield_variance_pct: string;
  tolerance: string;
  material_cost: string;
  overhead: string;
  total_cost: string;
  cost_per_packet: string;
  selling_price: string | null;
  profit_per_packet: string | null;
  margin_pct: string | null;
  historical_price: boolean;
  historical_tolerance: boolean;
  alert_count: number;
};

type Receivable = {
  customer_id: string;
  customer: string;
  invoiced: string;
  collected: string;
  outstanding: string;
  ageing_0_30: string;
  ageing_31_60: string;
  ageing_61_90: string;
  ageing_over_90: string;
};

type DashboardData = {
  scope: 'BUSINESS' | 'OWN';
  timezone: string;
  generated_at: string;
  orders: OrderSummary;
  sales: SalesSummary;
  customer_sales: CustomerSale[];
  product_sales: ProductSale[];
  stock?: StockItem[];
  production?: ProductionRun[];
  latest_production?: ProductionRun | null;
  production_alerts?: number;
  receivables?: Receivable[];
};

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Not available';
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function number(value: string | number) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 4
  }).format(Number(value));
}

function Metric({
  label,
  value,
  note,
  icon,
  warning = false
}: {
  label: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  warning?: boolean;
}) {
  return (
    <article className={`bd-metric ${warning ? 'bd-warning' : ''}`}>
      <div className="bd-metric-heading">
        <span>{label}</span>
        <span className="bd-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bd-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

async function fetchDashboard(
  token: string,
  signal?: AbortSignal
): Promise<DashboardData> {
  const response = await fetch(
    '/api/dashboard/summary',
    {
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal
    }
  );

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(
      body?.error ?? `Request failed (${response.status})`
    );
  }

  return response.json();
}


export default function BusinessDashboard({
  token,
  role,
  onUnauthorized
}: Props) {
  
  const [data, setData] =
    useState<DashboardData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchDashboard(token, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;

        setData(result);
        setError('');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;

        const message = e instanceof Error
          ? e.message
          : 'Dashboard failed.';

        if (message === 'UNAUTHORIZED') {
          onUnauthorized();
          return;
        }

        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [token, onUnauthorized, refreshVersion]);

  function refreshDashboard() {
    setLoading(true);
    setError('');
    setRefreshVersion(previous => previous + 1);
  }



  const business =
    (role === 'ADMIN' || role === 'OWNER') &&
    data?.scope === 'BUSINESS';

  const receivables = data?.receivables ?? [];
  const production = data?.production ?? [];
  const stock = data?.stock ?? [];
  const latest = data?.latest_production;

  const collected = receivables.reduce(
    (sum, row) => sum + Number(row.collected), 0
  );

  const outstanding = receivables.reduce(
    (sum, row) => sum + Number(row.outstanding), 0
  );

  const finished = stock.filter(
    row => row.kind === 'FINISHED'
  );

  const finishedSummary = finished.length
    ? finished.map(
        row => `${number(row.quantity)} ${row.unit}`
      ).join(' / ')
    : '0';

  const paymentTotal = collected + outstanding;

  const collectedPercent = paymentTotal > 0
    ? Math.min(100, Math.max(0, collected / paymentTotal * 100))
    : 0;

  const statuses = data ? [
    { label: 'Submitted', value: data.orders.submitted, color: 'amber' },
    { label: 'Approved', value: data.orders.approved, color: 'blue' },
    { label: 'Invoiced', value: data.orders.invoiced, color: 'purple' },
    { label: 'Dispatched', value: data.orders.dispatched, color: 'green' },
    { label: 'Rejected', value: data.orders.rejected, color: 'red' }
  ] : [];

  return (
    <div className="business-dashboard">
      <header className="bd-header">
        <div>
          <p className="eyebrow">LIVE OPERATIONS</p>

          <h2>
            {role === 'SALESMAN'
              ? 'My sales dashboard'
              : 'Business overview'}
          </h2>

          <p className="bd-muted">
            {role === 'SALESMAN'
              ? 'Your orders and invoiced sales.'
              : 'Orders, inventory, production and finance.'}
          </p>
        </div>

        <button
          type="button"
          className="bd-refresh"
          disabled={loading}
          onClick={refreshDashboard}
        >
          <RefreshCw size={17} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && (
        <p className="bd-error" role="alert">{error}</p>
      )}

      {loading && !data && (
        <p role="status">Loading live dashboard...</p>
      )}

      {data && (
        <>
          <p className="bd-updated">
            Last updated: {
              new Date(data.generated_at).toLocaleString(
                'en-IN',
                { timeZone: 'Asia/Kolkata' }
              )
            } IST
            {' | '}
            {data.scope === 'OWN'
              ? 'Your records only'
              : 'Business-wide records'}
          </p>

          <div className="bd-grid">
            <Metric
              label="Today's orders"
              value={data.orders.today_orders}
              note="Indian business date"
              icon={<ShoppingCart size={20}/>}
            />

            <Metric
              label="Total orders"
              value={data.orders.total_orders}
              note={`${data.orders.submitted} submitted`}
              icon={<ShoppingCart size={20}/>}
            />

            <Metric
              label="Today's invoiced sales"
              value={money(data.sales.today_sales)}
              note="Including GST"
              icon={<Receipt size={20}/>}
            />

            <Metric
              label="Total invoiced sales"
              value={money(data.sales.invoiced_sales)}
              note={`${data.sales.invoice_count} invoices`}
              icon={<Receipt size={20}/>}
            />

            <Metric
              label="Taxable sales"
              value={money(data.sales.taxable_sales)}
              note="Excluding GST"
              icon={<TrendingUp size={20}/>}
            />

            {business && (
              <>
                <Metric
                  label="Payments collected"
                  value={money(collected)}
                  note="Cumulative collections"
                  icon={<Wallet size={20}/>}
                />

                <Metric
                  label="Outstanding"
                  value={money(outstanding)}
                  note="Customer receivables"
                  icon={<Wallet size={20}/>}
                  warning={outstanding > 0}
                />

                <Metric
                  label="Finished inventory"
                  value={finishedSummary}
                  note={finished.map(row => row.sku).join(', ')}
                  icon={<Package size={20}/>}
                />

                <Metric
                  label="Latest cost per packet"
                  value={money(latest?.cost_per_packet)}
                  note={latest ? `Run #${latest.id}` : 'No production'}
                  icon={<Calculator size={20}/>}
                />

                <Metric
                  label="Latest gross margin"
                  value={latest?.margin_pct != null
                    ? `${latest.margin_pct}%`
                    : 'Not available'}
                  note={latest?.historical_price
                    ? 'Historical price estimate'
                    : 'Production cost based'}
                  icon={<TrendingUp size={20}/>}
                />

                <Metric
                  label="Production variance alerts"
                  value={data.production_alerts ?? 0}
                  note="All recorded production runs"
                  icon={<AlertTriangle size={20}/>}
                  warning={(data.production_alerts ?? 0) > 0}
                />

                <Metric
                  label="Latest production yield"
                  value={latest ? `${latest.yield_pct}%` : 'Not available'}
                  note={latest
                    ? `${number(latest.good_output)} / ${number(latest.expected_output)}`
                    : 'No production'}
                  icon={<Factory size={20}/>}
                />
              </>
            )}
          </div>

          <Section title="Order status">
            {data.orders.total_orders > 0 ? (
              <div
                className="bd-status-bar"
                aria-label="Order status distribution"
              >
                {statuses.filter(s => s.value > 0).map(s => (
                  <div
                    key={s.label}
                    className={`bd-bar-${s.color}`}
                    style={{
                      width: `${s.value / data.orders.total_orders * 100}%`
                    }}
                    title={`${s.label}: ${s.value}`}
                  />
                ))}
              </div>
            ) : (
              <p className="bd-muted">No orders recorded.</p>
            )}

            <div className="bd-legend">
              {statuses.map(s => (
                <span key={s.label}>
                  <i className={`bd-bar-${s.color}`}/>
                  {s.label}: <b>{s.value}</b>
                </span>
              ))}
            </div>
          </Section>

          <Section title="Customer-wise sales">
            <div className="bd-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Invoices</th>
                    <th>Quantity</th>
                    <th>Taxable sales</th>
                    <th>Invoice total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customer_sales.map(row => (
                    <tr key={row.customer_id}>
                      <td>{row.customer}</td>
                      <td>{row.invoices}</td>
                      <td>{number(row.quantity)}</td>
                      <td>{money(row.taxable_sales)}</td>
                      <td>{money(row.invoice_total)}</td>
                    </tr>
                  ))}

                  {data.customer_sales.length === 0 && (
                    <tr>
                      <td colSpan={5}>No invoiced sales.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Product-wise sales">
            <div className="bd-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Invoices</th>
                    <th>Quantity</th>
                    <th>Taxable sales</th>
                    <th>Invoice total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.product_sales.map(row => (
                    <tr key={row.item_id}>
                      <td>{row.product}</td>
                      <td>{row.invoices}</td>
                      <td>{number(row.quantity)} {row.unit}</td>
                      <td>{money(row.taxable_sales)}</td>
                      <td>{money(row.invoice_total)}</td>
                    </tr>
                  ))}

                  {data.product_sales.length === 0 && (
                    <tr>
                      <td colSpan={5}>No invoiced sales.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {business && (
            <>
              <Section title="Current inventory">
                <div className="bd-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Material / Product</th>
                        <th>Category</th>
                        <th>Available stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.map(row => (
                        <tr key={row.item_id}>
                          <td>{row.sku}</td>
                          <td>{row.name}</td>
                          <td>{row.kind}</td>
                          <td>
                            {number(row.quantity)} {row.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Production performance">
                {production.length === 0 && (
                  <p>No production runs recorded.</p>
                )}

                {production.slice(0, 5).map(run => {
                  const max = Math.max(
                    Number(run.expected_output),
                    Number(run.good_output),
                    1
                  );

                  return (
                    <article className="bd-run" key={run.id}>
                      <div className="bd-run-heading">
                        <strong>
                          Run #{run.id} - {run.product}
                        </strong>

                        <span className={
                          run.alert_count > 0
                            ? 'bd-alert-text'
                            : 'bd-ok-text'
                        }>
                          {run.alert_count} variance alerts
                        </span>
                      </div>

                      <div className="bd-bar-row">
                        <span>Expected</span>
                        <div className="bd-track">
                          <div
                            className="bd-bar-blue"
                            style={{
                              width: `${Number(run.expected_output) / max * 100}%`
                            }}
                          />
                        </div>
                        <b>{number(run.expected_output)}</b>
                      </div>

                      <div className="bd-bar-row">
                        <span>Actual</span>
                        <div className="bd-track">
                          <div
                            className={
                              run.alert_count > 0
                                ? 'bd-bar-amber'
                                : 'bd-bar-green'
                            }
                            style={{
                              width: `${Number(run.good_output) / max * 100}%`
                            }}
                          />
                        </div>
                        <b>{number(run.good_output)}</b>
                      </div>

                      <div className="bd-run-details">
                        <span>Yield: {run.yield_pct}%</span>
                        <span>Variance: {run.yield_variance_pct}%</span>
                        <span>Tolerance: {run.tolerance}%</span>
                        <span>Cost: {money(run.cost_per_packet)}</span>
                      </div>

                      {run.historical_tolerance && (
                        <small className="bd-muted">
                          Historical run evaluated using current tolerance.
                        </small>
                      )}
                    </article>
                  );
                })}
              </Section>

              {latest && (
                <Section title="Latest production costing">
                  <div className="bd-cost-grid">
                    {[
                      ['Material cost', money(latest.material_cost)],
                      ['Overhead', money(latest.overhead)],
                      ['Total production cost', money(latest.total_cost)],
                      ['Cost per packet', money(latest.cost_per_packet)],
                      ['Selling price', money(latest.selling_price)],
                      ['Profit per packet', money(latest.profit_per_packet)]
                    ].map(([label, value]) => (
                      <div key={label}>
                        <small>{label}</small>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>

                  {latest.historical_price && (
                    <p className="bd-muted">
                      Historical margin estimated using the current
                      product selling price.
                    </p>
                  )}
                </Section>
              )}

              <Section title="Payment collection">
                {paymentTotal > 0 && (
                  <div className="bd-status-bar">
                    <div
                      className="bd-bar-green"
                      style={{ width: `${collectedPercent}%` }}
                    />
                    <div
                      className="bd-bar-amber"
                      style={{ width: `${100 - collectedPercent}%` }}
                    />
                  </div>
                )}

                <div className="bd-legend">
                  <span>
                    <i className="bd-bar-green"/>
                    Collected: <b>{money(collected)}</b>
                  </span>

                  <span>
                    <i className="bd-bar-amber"/>
                    Outstanding: <b>{money(outstanding)}</b>
                  </span>
                </div>
              </Section>

              <Section title="Customer outstanding and ageing">
                <p className="bd-muted">
                  Ageing is calculated from invoice date,
                  not payment due date.
                </p>

                <div className="bd-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Invoiced</th>
                        <th>Collected</th>
                        <th>Outstanding</th>
                        <th>0-30 days</th>
                        <th>31-60 days</th>
                        <th>61-90 days</th>
                        <th>Over 90 days</th>
                      </tr>
                    </thead>

                    <tbody>
                      {receivables.map(row => (
                        <tr key={row.customer_id}>
                          <td>{row.customer}</td>
                          <td>{money(row.invoiced)}</td>
                          <td>{money(row.collected)}</td>
                          <td>{money(row.outstanding)}</td>
                          <td>{money(row.ageing_0_30)}</td>
                          <td>{money(row.ageing_31_60)}</td>
                          <td>{money(row.ageing_61_90)}</td>
                          <td>{money(row.ageing_over_90)}</td>
                        </tr>
                      ))}

                      {receivables.length === 0 && (
                        <tr>
                          <td colSpan={8}>No receivable records.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
