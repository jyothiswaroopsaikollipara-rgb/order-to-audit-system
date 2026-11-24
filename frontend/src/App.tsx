import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Factory, ShoppingCart, FileText, RefreshCw } from 'lucide-react';
import './App.css';
import ReportsCentre from './ReportsCentre';
import BusinessDashboard from './BusinessDashboard';
import MobileOrderEntry from './MobileOrderEntry';

type Role = 'ADMIN' | 'SALESMAN' | 'PRODUCTION' | 'AUDITOR' | 'OWNER';
type Session = {
  token: string;
  role: Role;
  userId: string;
};
type Order = {
  id: number;
  customer_id: number;
  customer_name: string;
  salesman_id: number;
  item_id: number;
  sku: string;
  qty: string;
  status: string;
  unit_price: string | null;
  order_value: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string | null;
};
type Invoice = { id: number; invoice_no: string; order_id: number; customer_name: string; taxable: string; cgst: string; sgst: string; igst: string; total: string; paid: string; outstanding: string };

type MasterItem = {
  id: number;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  units_per_carton: string | null;
  selling_price: string | null;
  gst_rate: string | null;
};

type Masters = {
  items: MasterItem[];
  customers: {
    id: number;
    name: string;
  }[];
  boms: {
    id: number;
    finished_item_id: number;
    expected_output: string;
  }[];
};
type BomLine = {
  item_id: number;
  planned_qty: string;
  sku: string;
  unit: string;
  units_per_carton: string | null;
};
type BomDetail = { id: number; expected_output: string; finished_product: string; lines: BomLine[] };

type ProductionRow = {
  id: number;
  bom_id: number;
  good_output: string;
  expected_output: string;
  material_cost: string;
  overhead: string;
  cost_per_packet: string;
  item_id: number;
  qty: string;
  planned_qty: string;
  damaged_qty: string;
  variance_pct: string | null;
  material_sku?: string;
  material_unit: string;
  finished_product: string;
  reference_selling_price: string | null;
  effective_tolerance: string;
  yield_variance_pct: string | null;
  yield_alert: boolean;
  material_alert: boolean;
  profit_per_packet: string | null;
  margin_pct: string | null;
  total_cost: string;
  historical_price: boolean;
  historical_tolerance: boolean;
  labour_cost: string | null;
  energy_cost: string | null;
};

type ProductionSettings = {
  variance_tolerance_pct: string;
};
type StockRow = {
  item_id: string | number;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
};
type InvoiceV2 = Invoice & { order_status: string; dispatched: boolean };
const allRoles: Role[] = ['ADMIN', 'SALESMAN', 'PRODUCTION', 'AUDITOR', 'OWNER'];
const nav = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: allRoles },
  { path: '/new-order', label: 'Create Order', icon: ShoppingCart, roles: ['SALESMAN'] as Role[] },
  { path: '/orders', label: 'Orders', icon: ShoppingCart, roles: ['ADMIN', 'SALESMAN', 'OWNER'] as Role[] },
  { path: '/invoices', label: 'Invoices', icon: FileText, roles: ['ADMIN', 'OWNER', 'AUDITOR'] as Role[] },
  { path: '/purchases', label: 'Purchases', icon: Package, roles: ['ADMIN', 'PRODUCTION'] as Role[] },
  { path: '/production', label: 'Production', icon: Factory, roles: ['ADMIN', 'PRODUCTION'] as Role[] },
  { path: '/production-report', label: 'Production Report', icon: Factory, roles: ['ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'] as Role[] },
  { path: '/stock-ledger', label: 'Stock Ledger', icon: Package, roles: ['ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'] as Role[] },
  { path: '/stock', label: 'Stock', icon: Package, roles: ['ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'] as Role[] },
  { path: '/receivables', label: 'Receivables', icon: Receipt, roles: ['ADMIN', 'AUDITOR', 'OWNER'] as Role[] },
  {
  path: '/reports',
  label: 'Reports & Audit',
  icon: FileText,
  roles: ['ADMIN', 'AUDITOR', 'OWNER'] as Role[]
},
];

async function api<T>(path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = response.status === 401 ? 'Session expired. Please sign in again.' : `Request failed (${response.status})`;
    try { const data: unknown = await response.json(); if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && response.status !== 401) message = data.error; } catch { /* non-JSON error */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
function messageOf(e: unknown) { return e instanceof Error ? e.message : 'Unexpected error'; }
function isPositive(value: string) { return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0; }
function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(response.status === 401 ? 'Invalid email or password.' : `Login failed (${response.status}).`);
      const data: unknown = await response.json();

if (
  !data ||
  typeof data !== 'object' ||
  !('token' in data) ||
  !('role' in data) ||
  !('userId' in data) ||
  typeof data.token !== 'string' ||
  typeof data.userId !== 'string' ||
  !/^\d+$/.test(data.userId) ||
  !allRoles.includes(data.role as Role)
) {
  throw new Error('Unexpected login response.');
}

onLogin({
  token: data.token,
  role: data.role as Role,
  userId: data.userId
});

navigate('/dashboard', { replace: true });
      if (!data || typeof data !== 'object' || !('token' in data) || !('role' in data) || typeof data.token !== 'string' || !allRoles.includes(data.role as Role)) throw new Error('Unexpected login response.');
      onLogin({
        token: data.token, role: data.role as Role,
        userId: ''
      }); navigate('/dashboard', { replace: true });
    } catch (e) { setError(messageOf(e)); } finally { setLoading(false); }
  }
  return <main className="login-screen"><section className="login-card"><div className="brand-mark"><ShieldCheck size={27}/></div><p className="eyebrow">OPERATIONS PLATFORM</p><h1>Order to Audit</h1><p className="muted">Secure access to orders, production, inventory and finance.</p><form onSubmit={submit}><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@company.com"/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter your password"/>{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button></form><p className="fineprint">Access is limited to authorized personnel.</p></section></main>;
}
function useRemote<T>(path: string, session: Session, onUnauthorized: () => void) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    let active = true;
    api<T>(path, session.token).then(data => { if (active) setState({ data, error: '', loading: false }); })
      .catch((e: unknown) => { if (!active) return; const error = messageOf(e); setState({ data: null, error, loading: false }); if (error.includes('Session expired')) onUnauthorized(); });
    return () => { active = false; };
  }, [path, session.token, revision, onUnauthorized]);
  return { ...state, refresh };
}
function Alert({ error, success }: { error?: string; success?: string }) { return <>{error && <p className="error" role="alert">{error}</p>}{success && <p className="success" role="status">{success}</p>}</>; }
function Panel({ title, children, onRefresh }: { title: string; children: ReactNode; onRefresh?: () => void }) { return <section className="panel"><div className="panel-heading"><h2>{title}</h2>{onRefresh && <button className="secondary" onClick={onRefresh} type="button"><RefreshCw size={16}/> Refresh</button>}</div>{children}</section>; }
function DataPage({ title, path, session, onUnauthorized }: { title: string; path: string; session: Session; onUnauthorized: () => void }) {
  const { data, error, loading, refresh } = useRemote<Record<string, unknown>[]>(path, session, onUnauthorized);
  const keys = data?.length ? Object.keys(data[0]) : [];
  return <Panel title={title} onRefresh={refresh}>{loading ? <p className="muted">Loading…</p> : error ? <Alert error={error}/> : !data?.length ? <p className="muted">No records found.</p> : <div className="table-wrap"><table><thead><tr>{keys.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{data.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{String(r[k] ?? '—')}</td>)}</tr>)}</tbody></table></div>}</Panel>;
}
function CreateOrder({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  return (
    <MobileOrderEntry
      key={session.userId}
      token={session.token}
      userId={session.userId}
      onUnauthorized={onUnauthorized}
    />
  );
}

function Orders({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const {
    data,
    error: loadError,
    loading,
    refresh
  } = useRemote<Order[]>(
    '/orders',
    session,
    onUnauthorized
  );

  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editOrder, setEditOrder] =
    useState<Order | null>(null);

  const [rejectOrder, setRejectOrder] =
    useState<Order | null>(null);

  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [reason, setReason] = useState('');

  const isAdmin = session.role === 'ADMIN';

  function handleError(e: unknown) {
    const msg = messageOf(e);
    setError(msg);

    if (msg.includes('Session expired')) {
      onUnauthorized();
    }
  }

  async function act(
    order: Order,
    action: 'approve' | 'invoice'
  ) {
    if (
      !window.confirm(
        `${action === 'approve'
          ? 'Approve'
          : 'Generate invoice for'} order #${order.id}?`
      )
    ) return;

    setBusy(order.id);
    setError('');
    setSuccess('');

    try {
      await api<unknown>(
        `/orders/${order.id}/${action}`,
        session.token,
        'POST'
      );

      setSuccess(
        `Order #${order.id}: ${
          action === 'approve'
            ? 'approved'
            : 'invoice issued'
        }.`
      );

      refresh();

    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  function openEdit(order: Order) {
    setRejectOrder(null);
    setEditOrder(order);
    setQuantity(String(order.qty));
    setUnitPrice(String(order.unit_price ?? ''));
    setError('');
    setSuccess('');
  }

  function openReject(order: Order) {
    setEditOrder(null);
    setRejectOrder(order);
    setReason('');
    setError('');
    setSuccess('');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();

    if (!editOrder) return;

    if (
      !isPositive(quantity) ||
      !isPositive(unitPrice)
    ) {
      setError('Enter a valid quantity and unit price.');
      return;
    }

    setBusy(editOrder.id);
    setError('');
    setSuccess('');

    try {
      await api<unknown>(
        `/orders/${editOrder.id}/edit`,
        session.token,
        'POST',
        {
          quantity,
          unitPrice
        }
      );

      setSuccess(
        `Order #${editOrder.id} updated successfully.`
      );

      setEditOrder(null);
      refresh();

    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  async function saveReject(event: FormEvent) {
    event.preventDefault();

    if (!rejectOrder) return;

    if (reason.trim().length < 3) {
      setError('Enter a valid rejection reason.');
      return;
    }

    if (
      !window.confirm(
        `Reject order #${rejectOrder.id}?`
      )
    ) return;

    setBusy(rejectOrder.id);
    setError('');
    setSuccess('');

    try {
      await api<unknown>(
        `/orders/${rejectOrder.id}/reject`,
        session.token,
        'POST',
        {
          reason: reason.trim()
        }
      );

      setSuccess(
        `Order #${rejectOrder.id} rejected.`
      );

      setRejectOrder(null);
      refresh();

    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title={
        session.role === 'SALESMAN'
          ? 'My orders'
          : 'Sales orders'
      }
      onRefresh={refresh}
    >
      <Alert
        error={loadError || error}
        success={success}
      />

      {loading ? (
        <p className="muted">Loading orders...</p>
      ) : !data?.length ? (
        <p className="muted">No orders found.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit price (₹)</th>
                <th>Order value (₹)</th>
                <th>Status</th>
                <th>Rejection reason</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {data.map(o => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>{o.customer_name}</td>
                  <td>{o.sku}</td>
                  <td>{o.qty}</td>

                  <td>
                    {o.unit_price == null
                      ? '—'
                      : Number(o.unit_price).toFixed(2)}
                  </td>

                  <td>
                    {o.order_value == null
                      ? '—'
                      : Number(o.order_value).toFixed(2)}
                  </td>

                  <td>
                    <span className="status-chip">
                      {o.status}
                    </span>
                  </td>

                  <td>
                    {o.rejection_reason || '—'}
                  </td>

                  {isAdmin && (
                    <td>
                      <div className="inline-actions">

                        {o.status === 'SUBMITTED' && (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy !== null}
                              onClick={() => openEdit(o)}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              className="primary"
                              disabled={busy !== null}
                              onClick={() => act(o, 'approve')}
                            >
                              Approve
                            </button>

                            <button
                              type="button"
                              className="secondary reject-button"
                              disabled={busy !== null}
                              onClick={() => openReject(o)}
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {o.status === 'APPROVED' && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy !== null}
                            onClick={() => act(o, 'invoice')}
                          >
                            Issue invoice
                          </button>
                        )}

                        {![
                          'SUBMITTED',
                          'APPROVED'
                        ].includes(o.status) && (
                          <span className="muted">—</span>
                        )}

                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && editOrder && (
        <form
          className="business-form payment-form"
          onSubmit={saveEdit}
        >
          <h3>Edit order #{editOrder.id}</h3>

          <p className="muted">
            {editOrder.customer_name} — {editOrder.sku}
          </p>

          <label htmlFor="edit-quantity">
            Quantity
          </label>

          <input
            id="edit-quantity"
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            required
          />

          <label htmlFor="edit-price">
            Unit selling price (₹)
          </label>

          <input
            id="edit-price"
            type="number"
            min="0.01"
            step="0.01"
            value={unitPrice}
            onChange={e => setUnitPrice(e.target.value)}
            required
          />

          <p>
            Estimated taxable value:{' '}
            <strong>
              ₹{(
                Number(quantity) * Number(unitPrice)
              ).toFixed(2)}
            </strong>
          </p>

          <div className="inline-actions">
            <button
              className="primary"
              disabled={busy !== null}
            >
              Save changes
            </button>

            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => setEditOrder(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isAdmin && rejectOrder && (
        <form
          className="business-form payment-form"
          onSubmit={saveReject}
        >
          <h3>Reject order #{rejectOrder.id}</h3>

          <p className="muted">
            {rejectOrder.customer_name} — {rejectOrder.sku}
          </p>

          <label htmlFor="rejection-reason">
            Rejection reason
          </label>

          <textarea
            id="rejection-reason"
            rows={4}
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Enter the reason for rejection"
            required
          />

          <div className="inline-actions">
            <button
              className="secondary reject-button"
              disabled={busy !== null}
            >
              Confirm rejection
            </button>

            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={() => setRejectOrder(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function Invoices({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const {
    data,
    error: loadError,
    loading,
    refresh
  } = useRemote<InvoiceV2[]>(
    '/invoices',
    session,
    onUnauthorized
  );

  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [payId, setPayId] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');

  const [paymentKey, setPaymentKey] = useState(
    () => crypto.randomUUID()
  );

  const [pdfBusy, setPdfBusy] = useState<number | null>(null);
  const [shareBusy, setShareBusy] = useState<number | null>(null);

  // Download invoice PDF
  async function downloadPdf(inv: InvoiceV2) {
    setPdfBusy(inv.id);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(
        `/api/invoices/${inv.id}/pdf`,
        {
          headers: {
            Authorization: `Bearer ${session.token}`
          }
        }
      );

      if (response.status === 401) {
        onUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(
          `PDF download failed (${response.status})`
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = url;
      link.download =
        `${inv.invoice_no.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(
        () => URL.revokeObjectURL(url),
        1000
      );

      setSuccess(`PDF downloaded for ${inv.invoice_no}.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPdfBusy(null);
    }
  }


async function shareInvoice(inv: InvoiceV2) {
  setShareBusy(inv.id);
  setError('');
  setSuccess('');

  try {
    const response = await fetch(
      `/api/invoices/${inv.id}/pdf`,
      {
        headers: {
          Authorization: `Bearer ${session.token}`
        }
      }
    );

    if (response.status === 401) {
      onUnauthorized();
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Invoice sharing failed (${response.status})`
      );
    }

    const blob = await response.blob();

    const filename =
      `${inv.invoice_no.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    const file = new File(
      [blob],
      filename,
      { type: 'application/pdf' }
    );

    const shareData = {
      files: [file],
      title: `Invoice ${inv.invoice_no}`,
      text: `Invoice ${inv.invoice_no} from South Indian Snacks`
    };

    if (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare(shareData)
    ) {
      try {
        await navigator.share(shareData);
        setSuccess('Invoice handed to the sharing application.');
        return;
      } catch (e) {
        if (
          e instanceof DOMException &&
          e.name === 'AbortError'
        ) {
          return;
        }
      }
    }

    // Fallback for unsupported desktop browsers
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );

    setSuccess(
      'Invoice downloaded. Attach the PDF in WhatsApp or email to share it with the customer.'
    );

  } catch (e) {
    setError(messageOf(e));

  } finally {
    setShareBusy(null);
  }
}

  // Dispatch invoice
  async function dispatch(inv: InvoiceV2) {
    if (
      inv.dispatched ||
      inv.order_status !== 'INVOICED'
    ) return;

    if (
      !window.confirm(
        `Dispatch invoice ${inv.invoice_no}? This will reduce finished-goods stock.`
      )
    ) return;

    setBusy(inv.id);
    setError('');
    setSuccess('');

    try {
      await api<unknown>(
        `/invoices/${inv.id}/dispatch`,
        session.token,
        'POST'
      );

      setSuccess(
        `Dispatch posted for ${inv.invoice_no}.`
      );

      refresh();
    } catch (e) {
      const msg = messageOf(e);
      setError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setBusy(null);
    }
  }

  // Record payment
  async function pay(event: FormEvent) {
    event.preventDefault();

    if (payId === null) return;

    setError('');
    setSuccess('');

    const inv = data?.find(x => x.id === payId);

    if (
      !inv ||
      !isPositive(amount) ||
      Number(amount) > Number(inv.outstanding)
    ) {
      setError(
        'Enter a positive amount no greater than the outstanding balance.'
      );
      return;
    }

    setBusy(payId);

    try {
      await api<unknown>(
        `/invoices/${payId}/payments`,
        session.token,
        'POST',
        {
          reference:
            reference.trim() || `UI-PAY-${paymentKey}`,
          amount
        }
      );

      setSuccess(
        `Payment recorded for ${inv.invoice_no}.`
      );

      setPayId(null);
      setAmount('');
      setReference('');
      setPaymentKey(crypto.randomUUID());

      refresh();
    } catch (e) {
      const msg = messageOf(e);
      setError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="GST invoices" onRefresh={refresh}>
      <Alert
        error={loadError || error}
        success={success}
      />

      {loading ? (
        <p className="muted">Loading invoices…</p>
      ) : !data?.length ? (
        <p className="muted">No invoices found.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Taxable</th>
                <th>CGST</th>
                <th>SGST</th>
                <th>IGST</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Dispatch status</th>
                <th>Invoice PDF</th>

                {session.role === 'ADMIN' && (
                  <th>Actions</th>
                )}
              </tr>
            </thead>

            <tbody>
              {data.map(inv => (
                <tr key={inv.id}>
                  <td>{inv.invoice_no}</td>
                  <td>{inv.customer_name}</td>
                  <td>{inv.taxable}</td>
                  <td>{inv.cgst}</td>
                  <td>{inv.sgst}</td>
                  <td>{inv.igst}</td>
                  <td>{inv.total}</td>
                  <td>{inv.paid}</td>
                  <td>{inv.outstanding}</td>

                  <td>
                    <span className="status-chip">
                      {inv.dispatched
                        ? 'DISPATCHED'
                        : inv.order_status === 'INVOICED'
                          ? 'PENDING'
                          : inv.order_status}
                    </span>
                  </td>

                  <td>
  <div className="inline-actions">

    <button
      type="button"
      className="secondary"
      disabled={pdfBusy !== null}
      onClick={() => downloadPdf(inv)}
    >
      {pdfBusy === inv.id
        ? 'Downloading…'
        : 'Download PDF'}
    </button>

    {session.role === 'ADMIN' && (
      <button
        type="button"
        className="secondary"
        disabled={shareBusy !== null}
        onClick={() => shareInvoice(inv)}
      >
        {shareBusy === inv.id
          ? 'Preparing…'
          : 'Share Invoice'}
      </button>
    )}

  </div>
</td>

                  {session.role === 'ADMIN' && (
                    <td>
                      <div className="inline-actions">
                        {!inv.dispatched &&
                          inv.order_status === 'INVOICED' && (
                            <button
                              className="secondary"
                              disabled={busy !== null}
                              onClick={() => dispatch(inv)}
                            >
                              Dispatch
                            </button>
                          )}

                        {Number(inv.outstanding) > 0 && (
                          <button
                            className="secondary"
                            disabled={busy !== null}
                            onClick={() => {
                              setPayId(inv.id);
                              setAmount('');
                              setReference('');
                              setError('');
                            }}
                          >
                            Record payment
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {session.role === 'ADMIN' && payId !== null && (
        <form
          className="business-form payment-form"
          onSubmit={pay}
        >
          <h3>
            Record payment —{' '}
            {data?.find(x => x.id === payId)?.invoice_no}
          </h3>

          <p className="muted">
            Outstanding:{' '}
            {data?.find(x => x.id === payId)?.outstanding}
          </p>

          <label htmlFor="payref">
            Payment reference (optional)
          </label>

          <input
            id="payref"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="Bank reference or auto-generated"
          />

          <label htmlFor="payamount">
            Amount (₹)
          </label>

          <input
            id="payamount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />

          <div className="inline-actions">
            <button
              className="primary"
              disabled={busy !== null}
            >
              Save payment
            </button>

            <button
              className="secondary"
              type="button"
              onClick={() => setPayId(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}



function PurchaseEntry({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const {
    data: masters,
    loading,
    error: loadError,
    refresh
  } = useRemote<Masters>(
    '/masters',
    session,
    onUnauthorized
  );

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [unit, setUnit] = useState('');

  const [reference, setReference] = useState(
    () => `UI-PUR-${crypto.randomUUID()}`
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selected = masters?.items.find(
    item => String(item.id) === itemId
  );

  const baseQuantity = selected
    ? quantityInBase(
        quantity,
        unit || selected.unit,
        selected.unit,
        selected.units_per_carton
      )
    : 0;

  const totalValue =
    Number(quantity) * Number(unitCost);

  const baseUnitCost = baseQuantity > 0
    ? totalValue / baseQuantity
    : 0;

  const validPreview =
    isPositive(quantity) &&
    isPositive(unitCost) &&
    Number.isFinite(baseQuantity) &&
    Number.isFinite(baseUnitCost) &&
    Number.isFinite(totalValue) &&
    baseQuantity > 0;

  function selectItem(value: string) {
    setItemId(value);

    const item = masters?.items.find(
      x => String(x.id) === value
    );

    setUnit(item?.unit ?? '');
    setQuantity('');
    setUnitCost('');
    setError('');
    setSuccess('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();

    setError('');
    setSuccess('');

    if (
      !selected ||
      !validPreview ||
      !reference.trim()
    ) {
      setError(
        'Enter a material, valid quantity, unit cost and reference.'
      );
      return;
    }

    if (
      ['piece', 'packet', 'carton'].includes(selected.unit) &&
      !Number.isInteger(baseQuantity)
    ) {
      setError('Item requires whole inventory units.');
      return;
    }

    if (!window.confirm(
      `Confirm purchase\n\n` +
      `Material: ${selected.sku}\n` +
      `Entered: ${quantity} ${unit}\n` +
      `Inventory receipt: ${baseQuantity} ${selected.unit}\n` +
      `Total value: ₹${totalValue.toFixed(2)}\n\n` +
      `This creates permanent inventory movements.`
    )) return;

    setBusy(true);

    try {
      const result = await api<{
        id: number;
        replayed: boolean;
        baseQuantity?: string;
        baseUnit?: string;
        purchaseValue?: string;
      }>(
        '/purchases',
        session.token,
        'POST',
        {
          reference: reference.trim(),
          itemId: Number(itemId),
          quantity,
          unitCost,
          unit
        }
      );

      setSuccess(
        result.replayed
          ? `Purchase #${result.id} already exists. No duplicate posted.`
          : `Purchase #${result.id} posted successfully. Received ${result.baseQuantity} ${result.baseUnit}.`
      );

      setQuantity('');
      setUnitCost('');
      setReference(
        `UI-PUR-${crypto.randomUUID()}`
      );

    } catch (e) {
      const msg = messageOf(e);
      setError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Purchase raw materials">
        <p className="muted">
          Record purchases in supported units.
          Inventory and costing are normalized
          automatically to the item's base unit.
        </p>

        <Alert
          error={loadError || error}
          success={success}
        />

        {loading ? (
          <p className="muted">
            Loading materials...
          </p>
        ) : (
          <form
            className="business-form production-form"
            onSubmit={submit}
          >
            <fieldset disabled={busy}>
              <label htmlFor="purchase-item">
                Material
              </label>

              <select
                id="purchase-item"
                required
                value={itemId}
                onChange={e =>
                  selectItem(e.target.value)
                }
              >
                <option value="">
                  Choose material
                </option>

                {masters?.items
                  .filter(x => x.kind !== 'FINISHED')
                  .map(x => (
                    <option key={x.id} value={x.id}>
                      {x.sku} ({x.kind})
                    </option>
                  ))}
              </select>

              {selected && (
                <>
                  <label htmlFor="purchase-unit">
                    Purchase unit
                  </label>

                  <select
                    id="purchase-unit"
                    value={unit}
                    onChange={e => {
                      setUnit(e.target.value);
                      setQuantity('');
                      setUnitCost('');
                    }}
                  >
                    {availableUnits(
                      selected.unit,
                      selected.units_per_carton
                    ).map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label htmlFor="purchase-qty">
                Quantity {unit && `(${unit})`}
              </label>

              <input
                id="purchase-qty"
                type="number"
                step="any"
                min="0"
                required
                value={quantity}
                onChange={e =>
                  setQuantity(e.target.value)
                }
              />

              <label htmlFor="purchase-cost">
                Unit cost (₹{unit && `/${unit}`})
              </label>

              <input
                id="purchase-cost"
                type="number"
                step="any"
                min="0"
                required
                value={unitCost}
                onChange={e =>
                  setUnitCost(e.target.value)
                }
              />

              {selected && validPreview && (
                <div className="production-metrics">
                  <div>
                    <span>Inventory receipt</span>
                    <strong>
                      {Number(baseQuantity.toFixed(4))}
                      {' '}{selected.unit}
                    </strong>
                  </div>

                  <div>
                    <span>Normalized unit cost</span>
                    <strong>
                      ₹{Number(baseUnitCost.toFixed(6))}
                      /{selected.unit}
                    </strong>
                  </div>

                  <div>
                    <span>Total purchase value</span>
                    <strong>
                      ₹{totalValue.toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}

              <label htmlFor="purchase-ref">
                Unique purchase reference
              </label>

              <input
                id="purchase-ref"
                required
                value={reference}
                onChange={e =>
                  setReference(e.target.value)
                }
              />

              <button
                className="primary"
                disabled={busy || !validPreview}
              >
                {busy
                  ? 'Posting...'
                  : 'Post purchase'}
              </button>
            </fieldset>
          </form>
        )}
      </Panel>

      {session.role === 'ADMIN' && (
        <CartonSettings
          session={session}
          onUnauthorized={onUnauthorized}
          items={masters?.items ?? []}
          onUpdated={() => {
            refresh();
            setItemId('');
            setUnit('');
            setQuantity('');
            setUnitCost('');
          }}
        />
      )}
    </>
  );
}


function CartonSettings({
  session,
  onUnauthorized,
  items,
  onUpdated
}: {
  session: Session;
  onUnauthorized: () => void;
  items: MasterItem[];
  onUpdated: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [ratio, setRatio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const eligible = items.filter(
    item => ['piece', 'packet'].includes(item.unit)
  );

  const selected = eligible.find(
    item => String(item.id) === itemId
  );

  function selectItem(value: string) {
    setItemId(value);

    const item = eligible.find(
      x => String(x.id) === value
    );

    setRatio(item?.units_per_carton ?? '');
    setError('');
    setSuccess('');
  }

  async function save(value: number | null) {
    setError('');
    setSuccess('');

    if (!selected) {
      setError('Choose an item.');
      return;
    }

    if (
      value !== null &&
      (
        !Number.isInteger(value) ||
        value <= 0 ||
        value > 1000000
      )
    ) {
      setError(
        'Enter a positive whole-number carton ratio.'
      );
      return;
    }

    if (!window.confirm(
      value === null
        ? `Disable carton conversion for ${selected.sku}?`
        : `Set 1 carton = ${value} ${selected.unit}(s) for ${selected.sku}?`
    )) return;

    setBusy(true);

    try {
      await api<unknown>(
        `/masters/items/${selected.id}/carton-ratio`,
        session.token,
        'POST',
        { unitsPerCarton: value }
      );

      setSuccess(
        value === null
          ? 'Carton conversion disabled.'
          : `Carton ratio saved for ${selected.sku}.`
      );

      setRatio(
        value === null ? '' : String(value)
      );

      onUpdated();

    } catch (e) {
      const msg = messageOf(e);
      setError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Carton conversion settings">
      <p className="muted">
        Configure how many pieces or packets
        are contained in one carton for each item.
        Existing inventory records are not changed.
      </p>

      <Alert error={error} success={success}/>

      <form
        className="business-form production-form"
        onSubmit={e => {
          e.preventDefault();
          void save(Number(ratio));
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="carton-item">
            Item
          </label>

          <select
            id="carton-item"
            required
            value={itemId}
            onChange={e =>
              selectItem(e.target.value)
            }
          >
            <option value="">
              Choose item
            </option>

            {eligible.map(item => (
              <option key={item.id} value={item.id}>
                {item.sku}
              </option>
            ))}
          </select>

          {selected && (
            <>
              <p className="muted">
                Current ratio:
                {' '}
                {selected.units_per_carton == null
                  ? 'Not configured'
                  : `1 carton = ${selected.units_per_carton} ${selected.unit}(s)`}
              </p>

              <label htmlFor="carton-ratio">
                Base units per carton
              </label>

              <input
                id="carton-ratio"
                type="number"
                min="1"
                max="1000000"
                step="1"
                required
                value={ratio}
                onChange={e =>
                  setRatio(e.target.value)
                }
              />

              <div className="inline-actions">
                <button
                  className="primary"
                  disabled={busy}
                >
                  Save carton ratio
                </button>

                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void save(null)}
                >
                  Disable conversion
                </button>
              </div>
            </>
          )}
        </fieldset>
      </form>
    </Panel>
  );
}



function availableUnits(
  base: string,
  ratio: string | null = null
): string[] {
  if (base === 'kg') return ['kg', 'g'];
  if (base === 'g') return ['g', 'kg'];

  if (base === 'litre') return ['litre', 'ml'];
  if (base === 'ml') return ['ml', 'litre'];

  if (
    ['piece', 'packet'].includes(base) &&
    Number(ratio) > 0
  ) {
    return [base, 'carton'];
  }

  return [base];
}

function quantityInBase(
  quantity: string,
  from: string,
  base: string,
  ratio: string | null = null
): number {
  const n = Number(quantity);

  if (!Number.isFinite(n) || n < 0) {
    return NaN;
  }

  if (from === base) return n;

  if (from === 'g' && base === 'kg') {
    return n / 1000;
  }

  if (from === 'kg' && base === 'g') {
    return n * 1000;
  }

  if (from === 'ml' && base === 'litre') {
    return n / 1000;
  }

  if (from === 'litre' && base === 'ml') {
    return n * 1000;
  }

  if (
    from === 'carton' &&
    ['piece', 'packet'].includes(base) &&
    Number(ratio) > 0
  ) {
    return n * Number(ratio);
  }

  return NaN;
}

function VarianceIndicator({
  value,
  tolerance
}: {
  value: number;
  tolerance: number;
}) {
  if (!Number.isFinite(value)) {
    return <span>—</span>;
  }

  const rounded = Number(value.toFixed(2));
  const outside = Math.abs(rounded) > tolerance;

  return (
    <span
      className={
        outside
          ? 'variance-alert'
          : 'variance-normal'
      }
    >
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(2)}%
      {outside ? ' · Alert' : ' · OK'}
    </span>
  );
}



function ProductionEntry({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const {
    data: stock,
    error: stockError,
    refresh: refreshStock
  } = useRemote<StockRow[]>(
    '/stock', session, onUnauthorized
  );

  const {
    data: details,
    error: detailError,
    loading: detailLoading
  } = useRemote<BomDetail[]>(
    '/production/boms', session, onUnauthorized
  );

  const {
    data: settings,
    error: settingsError
  } = useRemote<ProductionSettings>(
    '/production/settings', session, onUnauthorized
  );

  const tolerance = Number(
    settings?.variance_tolerance_pct ?? 3
  );

  const [bomId, setBomId] = useState('');
  const [goodOutput, setGoodOutput] = useState('');
  const [labour, setLabour] = useState('0');
  const [energy, setEnergy] = useState('0');

  const [issues, setIssues] = useState<
    Record<number, {
      quantity: string;
      damagedQty: string;
      unit: string;
    }>
  >({});

  const [requestKey, setRequestKey] =
    useState(() => crypto.randomUUID());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const bom = details?.find(
    b => String(b.id) === bomId
  );

  function selectBom(id: string) {
    setBomId(id);

    const selected = details?.find(
      b => String(b.id) === id
    );

    setIssues(
      Object.fromEntries(
        (selected?.lines ?? []).map(l => [
          l.item_id,
          {
            quantity: String(l.planned_qty),
            damagedQty: '0',
            unit: l.unit
          }
        ])
      )
    );

    setGoodOutput(
      selected
        ? String(selected.expected_output)
        : ''
    );

    setRequestKey(crypto.randomUUID());
    setSuccess('');
    setError('');
  }

  function editIssue(
    id: number,
    key: 'quantity' | 'damagedQty' | 'unit',
    value: string
  ) {
    setIssues(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value
      }
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (
      !bom ||
      !isPositive(goodOutput) ||
      !Number.isInteger(Number(goodOutput)) ||
      labour.trim() === '' ||
      energy.trim() === '' ||
      !Number.isFinite(Number(labour)) ||
      !Number.isFinite(Number(energy)) ||
      Number(labour) < 0 ||
      Number(energy) < 0
    ) {
      setError(
        'Enter a valid whole-number output and nonnegative overhead.'
      );
      return;
    }

    for (const line of bom.lines) {
      const issue = issues[line.item_id];

      if (!issue) {
        setError(`Missing issue for ${line.sku}`);
        return;
      }

      const issued = quantityInBase(
        issue.quantity,
        issue.unit,
        line.unit,
        line.units_per_carton
      );

      const balance = stock?.find(
        s => String(s.item_id) === String(line.item_id)
      );

      if (
        balance &&
        issued > Number(balance.quantity)
      ) {
        setError(
          `Insufficient stock for ${line.sku}. Available: ${balance.quantity} ${line.unit}`
        );
        return;
      }
    }

    const summary = bom.lines.map(line => {
      const issue = issues[line.item_id];

      return `${line.sku}: ${issue.quantity} ${issue.unit}, damaged ${issue.damagedQty} ${issue.unit}`;
    }).join('\n');

    if (!window.confirm(
      `Confirm production run\n\n${summary}\n\nGood output: ${goodOutput} packets\nLabour: ₹${labour}\nEnergy: ₹${energy}\n\nThis posts permanent inventory movements.`
    )) return;

    setBusy(true);

    try {
      const result = await api<{
        run: {
          id: number;
          cost_per_packet: string;
        };
        yieldVariancePct: string;
        alerts?: unknown[];
        margin?: {
          profitPerPacket: string;
          marginPct: string;
        } | null;
        replayed: boolean;
      }>(
        '/production-runs',
        session.token,
        'POST',
        {
          requestKey,
          bomId: Number(bomId),
          goodOutput,
          issues: bom.lines.map(line => ({
            itemId: Number(line.item_id),
            ...issues[line.item_id]
          })),
          labour,
          energy
        }
      );

      const marginText = result.margin
        ? ` · Margin ${result.margin.marginPct}%`
        : '';

      const alertText = result.alerts
        ? ` · ${result.alerts.length} variance alerts`
        : '';

      setSuccess(
        `Run #${result.run.id} ${
          result.replayed
            ? 'already existed'
            : 'posted'
        } · Yield variance ${result.yieldVariancePct}% · Cost/packet ₹${result.run.cost_per_packet}${marginText}${alertText}`
      );

      setBomId('');
      setGoodOutput('');
      setIssues({});
      setLabour('0');
      setEnergy('0');
      setRequestKey(crypto.randomUUID());

      refreshStock();

    } catch (e) {
      const msg = messageOf(e);
      setError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Record production run">
      <p className="muted">
        Enter actual material consumption.
        Damaged quantity is included in the issued
        quantity, not deducted a second time.
      </p>

      <Alert
        error={
          stockError ||
          detailError ||
          settingsError ||
          error
        }
        success={success}
      />

      <div className="variance-preview">
        Variance tolerance:
        <strong> ±{tolerance}%</strong>
      </div>

      {detailLoading ? (
        <p className="muted">
          Loading BOM details...
        </p>
      ) : (
        <form
          className="business-form production-form"
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            <label htmlFor="bom">
              Bill of materials
            </label>

            <select
              id="bom"
              value={bomId}
              onChange={e => selectBom(e.target.value)}
              required
            >
              <option value="">Choose BOM</option>

              {details?.map(b => (
                <option key={b.id} value={b.id}>
                  #{b.id} · {b.finished_product}
                  {' · Expected '}
                  {b.expected_output}
                </option>
              ))}
            </select>

            {bom && (
              <>
                <div className="variance-preview">
                  Expected output:
                  <strong> {bom.expected_output}</strong>

                  {' · Yield variance: '}

                  <VarianceIndicator
                    value={
                      isPositive(goodOutput)
                        ? (
                            Number(goodOutput) /
                            Number(bom.expected_output) - 1
                          ) * 100
                        : NaN
                    }
                    tolerance={tolerance}
                  />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Planned</th>
                        <th>Available</th>
                        <th>Input unit</th>
                        <th>Actual issued</th>
                        <th>Damaged</th>
                        <th>Base quantity</th>
                        <th>Variance</th>
                      </tr>
                    </thead>

                    <tbody>
                      {bom.lines.map(line => {
                        const issue = issues[line.item_id];

                        const balance = stock?.find(
                          s =>
                            String(s.item_id) ===
                            String(line.item_id)
                        );

                        const converted = quantityInBase(
                          issue?.quantity ?? '',
                          issue?.unit ?? line.unit,
                          line.unit,
                          line.units_per_carton
                        );

                        const variancePct =
                          Number(line.planned_qty) > 0 &&
                          isPositive(issue?.quantity ?? '')
                            ? (
                                converted /
                                Number(line.planned_qty) - 1
                              ) * 100
                            : NaN;

                        return (
                          <tr key={line.item_id}>
                            <td>{line.sku}</td>

                            <td>
                              {line.planned_qty} {line.unit}
                            </td>

                            <td>
                              {balance?.quantity ?? '—'}
                              {' '}{line.unit}
                            </td>

                            <td>
                              <select
                                aria-label={`${line.sku} unit`}
                                value={issue?.unit ?? line.unit}
                                onChange={e =>
                                  editIssue(
                                    line.item_id,
                                    'unit',
                                    e.target.value
                                  )
                                }
                              >
                                {availableUnits(
                                  line.unit,
                                  line.units_per_carton
                                ).map(unit => (
                                  <option
                                    key={unit}
                                    value={unit}
                                  >
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td>
                              <input
                                aria-label={`${line.sku} issued`}
                                type="number"
                                min="0.0001"
                                step="any"
                                required
                                value={issue?.quantity ?? ''}
                                onChange={e =>
                                  editIssue(
                                    line.item_id,
                                    'quantity',
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            <td>
                              <input
                                aria-label={`${line.sku} damaged`}
                                type="number"
                                min="0"
                                step="any"
                                required
                                value={issue?.damagedQty ?? '0'}
                                onChange={e =>
                                  editIssue(
                                    line.item_id,
                                    'damagedQty',
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            <td>
                              {Number.isFinite(converted)
                                ? `${Number(converted.toFixed(4))} ${line.unit}`
                                : '—'}
                            </td>

                            <td>
                              <VarianceIndicator
                                value={variancePct}
                                tolerance={tolerance}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <label htmlFor="good-output">
                  Good output (packets)
                </label>

                <input
                  id="good-output"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={goodOutput}
                  onChange={e =>
                    setGoodOutput(e.target.value)
                  }
                />

                <label htmlFor="labour">
                  Labour cost (₹)
                </label>

                <input
                  id="labour"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={labour}
                  onChange={e =>
                    setLabour(e.target.value)
                  }
                />

                <label htmlFor="energy">
                  Energy cost (₹)
                </label>

                <input
                  id="energy"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={energy}
                  onChange={e =>
                    setEnergy(e.target.value)
                  }
                />

                <div className="variance-preview">
                  Total overhead:
                  <strong>
                    {' ₹'}
                    {(
                      Number(labour) + Number(energy)
                    ).toFixed(2)}
                  </strong>
                </div>

                <button
                  className="primary"
                  disabled={busy || !settings}
                >
                  {busy
                    ? 'Posting...'
                    : 'Post production run'}
                </button>
              </>
            )}
          </fieldset>
        </form>
      )}
    </Panel>
  );
}


function ProductionReport({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const {
    data,
    error,
    loading,
    refresh
  } = useRemote<ProductionRow[]>(
    '/reports/production',
    session,
    onUnauthorized
  );

  const {
    data: settings,
    error: settingsError,
    refresh: refreshSettings
  } = useRemote<ProductionSettings>(
    '/production/settings',
    session,
    onUnauthorized
  );

  const [newTolerance, setNewTolerance] =
    useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');

  const runs = [
    ...new Map(
      (data ?? []).map(row => [row.id, row])
    ).values()
  ];

  async function saveTolerance(e: FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSuccess('');

    const value = Number(newTolerance);

    if (
      newTolerance.trim() === '' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      setSaveError(
        'Tolerance must be between 0 and 100%.'
      );
      return;
    }

    setSaving(true);

    try {
      await api<ProductionSettings>(
        '/production/settings',
        session.token,
        'POST',
        { tolerancePct: value }
      );

      setSuccess(
        `Variance tolerance updated to ${value}%.`
      );

      setNewTolerance('');
      refreshSettings();
      refresh();

    } catch (e) {
      const msg = messageOf(e);
      setSaveError(msg);

      if (msg.includes('Session expired')) {
        onUnauthorized();
      }
    } finally {
      setSaving(false);
    }
  }

  function displayMoney(value: string | null) {
    return value == null
      ? '—'
      : `₹${Number(value).toFixed(2)}`;
  }

  return (
    <Panel
      title="Production, variances and costing"
      onRefresh={() => {
        refresh();
        refreshSettings();
      }}
    >
      <Alert
        error={error || settingsError || saveError}
        success={success}
      />

      <div className="variance-preview">
        Current variance tolerance:
        <strong>
          {' ±'}
          {settings?.variance_tolerance_pct ?? '—'}%
        </strong>
      </div>

      {session.role === 'ADMIN' && (
        <form
          className="business-form tolerance-form"
          onSubmit={saveTolerance}
        >
          <label htmlFor="variance-tolerance">
            Configure variance tolerance (%)
          </label>

          <input
            id="variance-tolerance"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            placeholder={
              settings?.variance_tolerance_pct ?? '3'
            }
            value={newTolerance}
            onChange={e =>
              setNewTolerance(e.target.value)
            }
          />

          <button
            className="secondary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Update tolerance'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">
          Loading production report...
        </p>
      ) : !runs.length ? (
        <p className="muted">
          No production runs yet.
        </p>
      ) : (
        runs.map(run => {
          const materials = (data ?? []).filter(
            row => String(row.id) === String(run.id)
          );

          const alertCount =
            materials.filter(
              row => row.material_alert
            ).length +
            Number(run.yield_alert);

          const tolerance =
            Number(run.effective_tolerance);

          return (
            <section
              key={run.id}
              className="production-report-run"
            >
              <div className="panel-heading">
                <h3>
                  Production Run #{run.id}
                  {' · '}{run.finished_product}
                </h3>

                <span className={
                  alertCount
                    ? 'variance-alert'
                    : 'variance-normal'
                }>
                  {alertCount
                    ? `${alertCount} variance alerts`
                    : 'Within tolerance'}
                </span>
              </div>

              <div className="production-metrics">
                <div>
                  <span>Expected output</span>
                  <strong>{run.expected_output}</strong>
                </div>

                <div>
                  <span>Good output</span>
                  <strong>{run.good_output}</strong>
                </div>

                <div>
                  <span>Production yield</span>
                  <strong>
                    {(
                      Number(run.good_output) /
                      Number(run.expected_output) * 100
                    ).toFixed(2)}%
                  </strong>
                </div>

                <div>
                  <span>Yield variance</span>
                  <VarianceIndicator
                    value={
                      run.yield_variance_pct == null
                        ? NaN
                        : Number(run.yield_variance_pct)
                    }
                    tolerance={tolerance}
                  />
                </div>
              </div>

              <p className="muted">
                Tolerance: ±{run.effective_tolerance}%
                {' · '}
                {run.historical_tolerance
                  ? 'Saved at production'
                  : 'Current reference tolerance'}
              </p>

              <h4>Material consumption</h4>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Unit</th>
                      <th>Planned</th>
                      <th>Actual issued</th>
                      <th>Damaged</th>
                      <th>Variance</th>
                    </tr>
                  </thead>

                  <tbody>
                    {materials.map(row => (
                      <tr key={row.item_id}>
                        <td>
                          {row.material_sku ?? row.item_id}
                        </td>

                        <td>{row.material_unit}</td>
                        <td>{row.planned_qty}</td>
                        <td>{row.qty}</td>
                        <td>{row.damaged_qty}</td>

                        <td>
                          <VarianceIndicator
                            value={
                              row.variance_pct == null
                                ? NaN
                                : Number(row.variance_pct)
                            }
                            tolerance={tolerance}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>Production costing</h4>

              <div className="production-metrics">
                {[
                  ['Material cost', run.material_cost],
                  ['Labour cost', run.labour_cost],
                  ['Energy cost', run.energy_cost],
                  ['Total overhead', run.overhead],
                  ['Total cost', run.total_cost],
                  ['Cost per packet', run.cost_per_packet],
                  ['Selling price', run.reference_selling_price],
                  ['Profit per packet', run.profit_per_packet]
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>
                      {displayMoney(value)}
                    </strong>
                  </div>
                ))}

                <div>
                  <span>Gross margin</span>
                  <strong className={
                    Number(run.margin_pct) < 0
                      ? 'variance-alert'
                      : 'variance-normal'
                  }>
                    {run.margin_pct == null
                      ? '—'
                      : `${run.margin_pct}%`}
                  </strong>
                </div>
              </div>

              <p className="muted">
                {run.historical_price
                  ? 'Margin uses the selling price saved at production.'
                  : 'Estimated margin uses the current master selling price.'}
                {' GST is excluded.'}
              </p>
            </section>
          );
        })
      )}
    </Panel>
  );
}



function Dashboard({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const role = session.role;

  if (
    role === 'ADMIN' ||
    role === 'OWNER' ||
    role === 'SALESMAN'
  ) {
    return (
      <BusinessDashboard
        token={session.token}
        role={role}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <>
      <div className="hero">
        <p className="eyebrow">WORKSPACE OVERVIEW</p>

        <h2>Welcome back</h2>

        <p className="muted">
          Signed in as {role.toLowerCase()}.
          Select a section to work with live operational data.
        </p>
      </div>

      <div className="tiles">
        {role === 'PRODUCTION' && (
          <>
            <div className="tile">
              <Factory />
              <h3>Production</h3>
              <p>
                Record production runs and review material
                consumption and yield variances.
              </p>
            </div>

            <div className="tile">
              <Package />
              <h3>Inventory</h3>
              <p>
                Record purchases and review current stock.
              </p>
            </div>
          </>
        )}

        {role === 'AUDITOR' && (
          <>
            <div className="tile">
              <FileText />
              <h3>Reports and audit</h3>
              <p>
                Review operational reports and export
                audit records.
              </p>
            </div>

            <div className="tile">
              <Receipt />
              <h3>Finance</h3>
              <p>
                Review GST invoices, collections
                and outstanding receivables.
              </p>
            </div>

            <div className="tile">
              <Package />
              <h3>Inventory</h3>
              <p>
                Review stock balances and movement ledgers.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Shell({ session, logout }: { session: Session; logout: () => void }) {
  const items = nav.filter(item => item.roles.includes(session.role));
  const allowed = (path: string) => items.some(x => x.path === path);
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><strong>Order to Audit</strong><small>Operations console</small></div></div><nav>{items.map(({path,label,icon:Icon})=><NavLink key={path} to={path} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom"><span className="role-chip">{session.role}</span><button className="logout" onClick={logout}><LogOut size={17}/><span>Sign out</span></button></div></aside><main className="content"><header className="topbar"><span>Operations / {session.role.toLowerCase()}</span><span className="live-dot"><span>Operations workspace</span></span></header><div className="page"><Routes><Route path="/dashboard" element={<Dashboard
  session={session}
  onUnauthorized={logout}
/>}/><Route path="/new-order" element={allowed('/new-order')?<CreateOrder session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/orders" element={allowed('/orders')?<Orders session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/invoices" element={allowed('/invoices')?<Invoices session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/purchases" element={allowed('/purchases')?<PurchaseEntry session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/production" element={allowed('/production')?<ProductionEntry session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/production-report" element={allowed('/production-report')?<ProductionReport session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/stock-ledger" element={allowed('/stock-ledger')?<DataPage title="Stock movement ledger" path="/stock/ledger" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/stock" element={allowed('/stock')?<DataPage title="Current stock" path="/stock" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/receivables" element={allowed('/receivables')?<DataPage title="Receivables" path="/reports/receivables" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route
  path="/reports"
  element={
    allowed('/reports') ? (
      <ReportsCentre
        token={session.token}
        onUnauthorized={logout}
      />
    ) : (
      <Navigate to="/dashboard" replace />
    )
  }
/>

<Route
  path="*"
  element={<Navigate to="/dashboard" replace />}
/></Routes></div></main></div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  const logout = useCallback(() => {
  setSession(null);
}, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            session ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Login onLogin={setSession} />
            )
          }
        />

        <Route
          path="/*"
          element={
            session ? (
              <Shell
                session={session}
                logout={logout}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}