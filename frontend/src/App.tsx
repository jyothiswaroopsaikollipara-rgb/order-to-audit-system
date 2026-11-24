import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Factory, ShoppingCart, FileText, RefreshCw } from 'lucide-react';
import './App.css';

type Role = 'ADMIN' | 'SALESMAN' | 'PRODUCTION' | 'AUDITOR' | 'OWNER';
type Session = { token: string; role: Role };
type Order = { id: number; customer_id: number; customer_name: string; salesman_id: number; item_id: number; sku: string; qty: string; status: string };
type Invoice = { id: number; invoice_no: string; order_id: number; customer_name: string; taxable: string; cgst: string; sgst: string; igst: string; total: string; paid: string; outstanding: string };
type Masters = { items: { id: number; sku: string; kind: string }[]; customers: { id: number; name: string }[]; boms: { id: number; finished_item_id: number; expected_output: string }[] };
type BomLine = { item_id: number; planned_qty: string; sku: string };
type BomDetail = { id: number; expected_output: string; finished_product: string; lines: BomLine[] };
type ProductionRow = { id: number; bom_id: number; good_output: string; expected_output: string; material_cost: string; overhead: string; cost_per_packet: string; item_id: number; qty: string; planned_qty: string; damaged_qty: string; variance_pct: string; material_sku?: string; };
type StockRow = { item_id: number; sku: string; balance: string };
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
      if (!data || typeof data !== 'object' || !('token' in data) || !('role' in data) || typeof data.token !== 'string' || !allRoles.includes(data.role as Role)) throw new Error('Unexpected login response.');
      onLogin({ token: data.token, role: data.role as Role }); navigate('/dashboard', { replace: true });
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
function CreateOrder({ session, onUnauthorized }: { session: Session; onUnauthorized: () => void }) {
  const { data: masters, error: masterError, loading } = useRemote<Masters>('/masters', session, onUnauthorized);
  const [customerId, setCustomerId] = useState(''); const [itemId, setItemId] = useState(''); const [quantity, setQuantity] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const products = masters?.items.filter(item => item.kind === 'FINISHED') ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('');
    if (!customerId || !itemId || !isPositive(quantity)) { setError('Select a customer and finished product, and enter a positive quantity.'); return; }
    setPending(true);
    try {
      const order = await api<{ id: number; status: string }>('/orders', session.token, 'POST', { requestKey, customerId: Number(customerId), itemId: Number(itemId), quantity });
      setSuccess(`Order #${order.id} submitted (${order.status}). Admin approval is required.`); setQuantity(''); setRequestKey(crypto.randomUUID());
    } catch (e) { const msg = messageOf(e); setError(msg); if (msg.includes('Session expired')) onUnauthorized(); }
    finally { setPending(false); }
  }
  return <Panel title="Create sales order"><p className="muted">Submit an order for admin review. Stock is checked when the admin approves it.</p><Alert error={masterError || error} success={success}/>{loading ? <p className="muted">Loading customers and products…</p> : <form className="business-form" onSubmit={submit}><label htmlFor="customer">Customer</label><select id="customer" required value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Select customer</option>{masters?.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label htmlFor="product">Finished product</label><select id="product" required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku}</option>)}</select><label htmlFor="quantity">Quantity (packets)</label><input id="quantity" type="number" min="0.0001" step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="e.g. 120"/><button className="primary" disabled={pending || !masters?.customers.length || !products.length}>{pending ? 'Submitting…' : 'Submit order'}</button></form>}</Panel>;
}
function Orders({ session, onUnauthorized }: { session: Session; onUnauthorized: () => void }) {
  const { data, error: loadError, loading, refresh } = useRemote<Order[]>('/orders', session, onUnauthorized);
  const [busy, setBusy] = useState<number | null>(null); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function act(order: Order, action: 'approve' | 'invoice') {
    if (!window.confirm(`${action === 'approve' ? 'Approve' : 'Generate invoice for'} order #${order.id}?`)) return;
    setBusy(order.id); setError(''); setSuccess('');
    try { await api<unknown>(`/orders/${order.id}/${action}`, session.token, 'POST'); setSuccess(`Order #${order.id}: ${action === 'approve' ? 'approved' : 'invoice issued'}.`); refresh(); }
    catch (e) { const msg = messageOf(e); setError(msg); if (msg.includes('Session expired')) onUnauthorized(); }
    finally { setBusy(null); }
  }
  return <Panel title={session.role === 'SALESMAN' ? 'My orders' : 'Sales orders'} onRefresh={refresh}><Alert error={loadError || error} success={success}/>{loading ? <p className="muted">Loading orders…</p> : !data?.length ? <p className="muted">No orders found.</p> : <div className="table-wrap"><table><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Quantity</th><th>Status</th>{session.role === 'ADMIN' && <th>Actions</th>}</tr></thead><tbody>{data.map(o=><tr key={o.id}><td>#{o.id}</td><td>{o.customer_name}</td><td>{o.sku}</td><td>{o.qty}</td><td><span className="status-chip">{o.status}</span></td>{session.role === 'ADMIN' && <td><div className="inline-actions">{o.status === 'SUBMITTED' && <button className="secondary" disabled={busy !== null} onClick={()=>act(o,'approve')}>Approve</button>}{o.status === 'APPROVED' && <button className="secondary" disabled={busy !== null} onClick={()=>act(o,'invoice')}>Issue invoice</button>}{!['SUBMITTED','APPROVED'].includes(o.status) && <span className="muted">—</span>}</div></td>}</tr>)}</tbody></table></div>}</Panel>;
}
function Invoices({ session, onUnauthorized }: { session: Session; onUnauthorized: () => void }) {
  const { data, error: loadError, loading, refresh } = useRemote<InvoiceV2[]>('/invoices', session, onUnauthorized);
  const [busy, setBusy] = useState<number | null>(null); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [payId, setPayId] = useState<number | null>(null); const [reference, setReference] = useState(''); const [amount, setAmount] = useState('');
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  async function dispatch(inv: InvoiceV2) {
    if (inv.dispatched || inv.order_status !== 'INVOICED') return;
    if (!window.confirm(`Dispatch invoice ${inv.invoice_no}? This will reduce finished-goods stock.`)) return;
    setBusy(inv.id); setError(''); setSuccess('');
    try { await api<unknown>(`/invoices/${inv.id}/dispatch`, session.token, 'POST'); setSuccess(`Dispatch posted for ${inv.invoice_no}.`); refresh(); }
    catch (e) { const msg = messageOf(e); setError(msg); if (msg.includes('Session expired')) onUnauthorized(); }
    finally { setBusy(null); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault(); if (payId === null) return;
    setError(''); setSuccess('');
    const inv = data?.find(x => x.id === payId);
    if (!inv || !isPositive(amount) || Number(amount) > Number(inv.outstanding)) { setError('Enter a positive amount no greater than the outstanding balance.'); return; }
    setBusy(payId);
    try { await api<unknown>(`/invoices/${payId}/payments`, session.token, 'POST', { reference: reference.trim() || `UI-PAY-${paymentKey}`, amount }); setSuccess(`Payment recorded for ${inv.invoice_no}.`); setPayId(null); setAmount(''); setReference(''); setPaymentKey(crypto.randomUUID()); refresh(); }
    catch (e) { const msg = messageOf(e); setError(msg); if (msg.includes('Session expired')) onUnauthorized(); }
    finally { setBusy(null); }
  }
  return <Panel title="GST invoices" onRefresh={refresh}><Alert error={loadError || error} success={success}/>{loading ? <p className="muted">Loading invoices…</p> : !data?.length ? <p className="muted">No invoices found.</p> : <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Dispatch status</th>{session.role === 'ADMIN' && <th>Actions</th>}</tr></thead><tbody>{data.map(inv=><tr key={inv.id}><td>{inv.invoice_no}</td><td>{inv.customer_name}</td><td>{inv.taxable}</td><td>{inv.cgst}</td><td>{inv.sgst}</td><td>{inv.igst}</td><td>{inv.total}</td><td>{inv.paid}</td><td>{inv.outstanding}</td><td><span className="status-chip">{inv.dispatched ? 'DISPATCHED' : inv.order_status === 'INVOICED' ? 'PENDING' : inv.order_status}</span></td>{session.role === 'ADMIN' && <td><div className="inline-actions">{!inv.dispatched && inv.order_status === 'INVOICED' && <button className="secondary" disabled={busy !== null} onClick={()=>dispatch(inv)}>Dispatch</button>}{Number(inv.outstanding) > 0 && <button className="secondary" disabled={busy !== null} onClick={()=>{setPayId(inv.id);setAmount('');setReference('');setError('');}}>Record payment</button>}</div></td>}</tr>)}</tbody></table></div>}{session.role === 'ADMIN' && payId !== null && <form className="business-form payment-form" onSubmit={pay}><h3>Record payment — {data?.find(x=>x.id===payId)?.invoice_no}</h3><p className="muted">Outstanding: {data?.find(x=>x.id===payId)?.outstanding}</p><label htmlFor="payref">Payment reference (optional)</label><input id="payref" value={reference} onChange={e=>setReference(e.target.value)} placeholder="Bank reference or auto-generated"/><label htmlFor="payamount">Amount (₹)</label><input id="payamount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/><div className="inline-actions"><button className="primary" disabled={busy !== null}>Save payment</button><button className="secondary" type="button" onClick={()=>setPayId(null)}>Cancel</button></div></form>}</Panel>;
}

function PurchaseEntry({ session, onUnauthorized }: { session: Session; onUnauthorized: () => void }) {
  const { data: masters, loading, error: loadError } = useRemote<Masters>('/masters', session, onUnauthorized);
  const [itemId, setItemId] = useState(''); const [quantity, setQuantity] = useState(''); const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState(() => `UI-PUR-${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!itemId || !isPositive(quantity) || !isPositive(unitCost) || !reference.trim()) { setError('Enter a material, positive quantity and unit cost, and a reference.'); return; }
    if (!window.confirm(`Post purchase of ${quantity} units? This increases stock and creates an audit event.`)) return;
    setBusy(true); setError(''); setSuccess('');
    try { const result = await api<{id:number;replayed:boolean}>('/purchases',session.token,'POST',{reference:reference.trim(),itemId:Number(itemId),quantity,unitCost}); setSuccess(`Purchase #${result.id} ${result.replayed?'already existed (no duplicate posted)':'posted successfully'}.`); if (!result.replayed) {setQuantity('');setUnitCost('');setReference(`UI-PUR-${crypto.randomUUID()}`);} }
    catch(e){const msg=messageOf(e);setError(msg);if(msg.includes('Session expired'))onUnauthorized();}finally{setBusy(false);}
  }
  return <Panel title="Purchase raw materials"><p className="muted">Post a stock receipt. Reference is retained after a failed request so retries are safe.</p><Alert error={loadError || error} success={success}/>{loading?<p className="muted">Loading materials…</p>:<form className="business-form" onSubmit={submit}><label htmlFor="purchase-item">Material</label><select id="purchase-item" required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Choose material</option>{masters?.items.filter(x=>x.kind!=='FINISHED').map(x=><option key={x.id} value={x.id}>{x.sku} ({x.kind})</option>)}</select><label htmlFor="purchase-qty">Quantity</label><input id="purchase-qty" type="number" step="any" min="0.0001" required value={quantity} onChange={e=>setQuantity(e.target.value)}/><label htmlFor="purchase-cost">Unit cost (₹)</label><input id="purchase-cost" type="number" step="any" min="0.0001" required value={unitCost} onChange={e=>setUnitCost(e.target.value)}/><label htmlFor="purchase-ref">Unique purchase reference</label><input id="purchase-ref" required value={reference} onChange={e=>setReference(e.target.value)}/><button className="primary" disabled={busy}>{busy?'Posting…':'Post purchase'}</button></form>}</Panel>;
}
function ProductionEntry({session,onUnauthorized}:{session:Session;onUnauthorized:()=>void}) {
  const {error:masterError,loading:masterLoading}=useRemote<Masters>('/masters',session,onUnauthorized);
  const {data:stock,error:stockError,refresh:refreshStock}=useRemote<StockRow[]>('/stock',session,onUnauthorized);
  const {data:details,error:detailError,loading:detailLoading}=useRemote<BomDetail[]>('/production/boms',session,onUnauthorized);
  const [bomId,setBomId]=useState('');const [goodOutput,setGoodOutput]=useState('');const [labour,setLabour]=useState('0');const [energy,setEnergy]=useState('0');
  const [issues,setIssues]=useState<Record<number,{quantity:string;damagedQty:string}>>({});
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const bom=details?.find(b=>String(b.id)===bomId);
  function selectBom(id:string){setBomId(id);const selected=details?.find(b=>String(b.id)===id);setIssues(Object.fromEntries((selected?.lines??[]).map(l=>[l.item_id,{quantity:String(l.planned_qty),damagedQty:'0'}])));setGoodOutput(selected?String(selected.expected_output):'');setRequestKey(crypto.randomUUID());setSuccess('');setError('');}
  function editIssue(id:number,key:'quantity'|'damagedQty',value:string){setIssues(prev=>({...prev,[id]:{...prev[id],quantity:prev[id]?.quantity??'',damagedQty:prev[id]?.damagedQty??'0',[key]:value}}));}
  async function submit(e:FormEvent){e.preventDefault();setError('');setSuccess('');
    if(!bom||!isPositive(goodOutput)||Number(labour)<0||Number(energy)<0||!Number.isFinite(Number(labour))||!Number.isFinite(Number(energy))){setError('Select a BOM and enter valid output and nonnegative overhead.');return;}
    for(const l of bom.lines){const x=issues[l.item_id];if(!x||!isPositive(x.quantity)||Number(x.damagedQty)<0||Number(x.damagedQty)>Number(x.quantity)||!Number.isFinite(Number(x.damagedQty))){setError(`Invalid issue or damaged quantity for ${l.sku}.`);return;}const balance=stock?.find(s=>Number(s.item_id)===l.item_id);if(balance&&Number(x.quantity)>Number(balance.balance)){setError(`Insufficient stock for ${l.sku}; available ${balance.balance}.`);return;}}
    const materialSummary = bom.lines.map(l => {
  const issue = issues[l.item_id];

  return `${l.sku}: Issued ${issue.quantity}, Damaged ${issue.damagedQty}`;
}).join('\n');

const confirmation = [
  'Confirm production run',
  '',
  `Expected output: ${bom.expected_output}`,
  `Good output: ${goodOutput}`,
  '',
  'Material consumption:',
  materialSummary,
  '',
  `Labour: ₹${labour}`,
  `Energy: ₹${energy}`,
  '',
  'This will post permanent inventory movements.'
].join('\n');

if (!window.confirm(confirmation)) return;
    setBusy(true);try{const result=await api<{run:{id:number;cost_per_packet:string};yieldVariancePct:string;replayed:boolean}>('/production-runs',session.token,'POST',{requestKey,bomId:Number(bomId),goodOutput,issues:bom.lines.map(l=>({itemId:l.item_id,quantity:issues[l.item_id].quantity,damagedQty:issues[l.item_id].damagedQty})),labour,energy});setSuccess(`Run #${result.run.id} ${result.replayed?'already existed':'posted'} · yield variance ${result.yieldVariancePct}% · cost/packet ₹${result.run.cost_per_packet}.`);if(!result.replayed){setRequestKey(crypto.randomUUID());refreshStock();}}
    catch(e){const msg=messageOf(e);setError(msg);if(msg.includes('Session expired'))onUnauthorized();}finally{setBusy(false);}
  }
  return <Panel title="Record production run"><p className="muted">All BOM materials are mandatory. Quantities are actual material issues; damaged quantity is a subset of the issue, not an additional stock deduction.</p><Alert error={masterError||stockError||detailError||error} success={success}/>{masterLoading||detailLoading?<p className="muted">Loading BOM details…</p>:<form className="business-form production-form" onSubmit={submit}><label htmlFor="bom">Bill of materials</label><select id="bom" required value={bomId} onChange={e=>selectBom(e.target.value)}><option value="">Choose BOM</option>{details?.map(b=><option key={b.id} value={b.id}>#{b.id} · {b.finished_product} · expected {b.expected_output}</option>)}</select>{bom&&<><div className="variance-preview">Expected output: <strong>{bom.expected_output}</strong>{isPositive(goodOutput)&&<span> · Preview yield variance: <strong>{((Number(goodOutput)/Number(bom.expected_output)-1)*100).toFixed(2)}%</strong></span>}</div><div className="table-wrap"><table><thead><tr><th>Material</th><th>Planned</th><th>Available</th><th>Actual issued</th><th>Damaged</th><th>Variance</th></tr></thead><tbody>{bom.lines.map(l=>{const x=issues[l.item_id];const balance=stock?.find(s=>Number(s.item_id)===l.item_id);return <tr key={l.item_id}><td>{l.sku}</td><td>{l.planned_qty}</td><td>{balance?.balance??'—'}</td><td><input aria-label={`${l.sku} actual issued`} type="number" step="any" min="0.0001" required value={x?.quantity??''} onChange={e=>editIssue(l.item_id,'quantity',e.target.value)}/></td><td><input aria-label={`${l.sku} damaged`} type="number" step="any" min="0" required value={x?.damagedQty??'0'} onChange={e=>editIssue(l.item_id,'damagedQty',e.target.value)}/></td><td>{x&&isPositive(x.quantity)&&Number(l.planned_qty)>0?`${((Number(x.quantity)/Number(l.planned_qty)-1)*100).toFixed(2)}%`:'—'}</td></tr>;})}</tbody></table></div><label htmlFor="good-output">Good output (packets)</label><input id="good-output" type="number" step="any" min="0.0001" required value={goodOutput} onChange={e=>setGoodOutput(e.target.value)}/><label htmlFor="labour">Labour cost (₹)</label><input id="labour" type="number" step="any" min="0" required value={labour} onChange={e=>setLabour(e.target.value)}/><label htmlFor="energy">Energy cost (₹)</label><input id="energy" type="number" step="any" min="0" required value={energy} onChange={e=>setEnergy(e.target.value)}/><p className="muted">Request key: {requestKey}</p><button className="primary" disabled={busy}>{busy?'Posting…':'Post production run'}</button></>}</form>}</Panel>;
}
function ProductionReport({
  session,
  onUnauthorized
}: {
  session: Session;
  onUnauthorized: () => void;
}) {
  const { data, error, loading, refresh } =
    useRemote<ProductionRow[]>(
      '/reports/production',
      session,
      onUnauthorized
    );

  const runs = [
    ...new Map((data ?? []).map(x => [x.id, x])).values()
  ];

  return (
    <Panel
      title="Production and material variances"
      onRefresh={refresh}
    >
      <Alert error={error} />

      {loading ? (
        <p className="muted">Loading production report…</p>
      ) : !data?.length ? (
        <p className="muted">No production runs yet.</p>
      ) : (
        <>
          {runs.map(run => (
            <section
              key={run.id}
              className="production-report-run"
            >
              <h3>Production Run #{run.id}</h3>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Expected output</th>
                      <th>Good output</th>
                      <th>Yield variance</th>
                      <th>Material cost</th>
                      <th>Overhead</th>
                      <th>Cost / packet</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>{run.expected_output}</td>
                      <td>{run.good_output}</td>
                      <td>
                        {(
                          (Number(run.good_output) /
                            Number(run.expected_output) - 1) *
                          100
                        ).toFixed(2)}%
                      </td>
                      <td>₹{run.material_cost}</td>
                      <td>₹{run.overhead}</td>
                      <td>₹{run.cost_per_packet}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h4>Material Consumption Details</h4>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Planned</th>
                      <th>Actual issued</th>
                      <th>Damaged quantity</th>
                      <th>Material variance</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data
                      .filter(row => row.id === run.id)
                      .map(row => (
                        <tr key={`${row.id}-${row.item_id}`}>
                          <td>
                            {row.material_sku ??
                              `Item #${row.item_id}`}
                          </td>
                          <td>{Number(row.planned_qty)}</td>
                          <td>{Number(row.qty)}</td>
                          <td
                            className={
                              Number(row.damaged_qty) > 0
                                ? 'variance-warning'
                                : ''
                            }
                          >
                            {Number(row.damaged_qty)}
                          </td>
                          <td
                            className={
                              Number(row.variance_pct) > 0
                                ? 'variance-warning'
                                : ''
                            }
                          >
                            {Number(row.variance_pct) > 0
                              ? '+'
                              : ''}
                            {Number(row.variance_pct).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </Panel>
  );
}

function Dashboard({ role }: { role: Role }) { return <><div className="hero"><p className="eyebrow">WORKSPACE OVERVIEW</p><h2>Welcome back</h2><p className="muted">Signed in as {role.toLowerCase()}. Select a section to work with live operational data.</p></div><div className="tiles"><div className="tile"><ShoppingCart/><h3>Sales orders</h3><p>{role === 'SALESMAN' ? 'Create orders and track their status.' : 'Review orders and manage approvals.'}</p></div><div className="tile"><Factory/><h3>Production</h3><p>Record production runs and review material and yield variances.</p></div><div className="tile"><Receipt/><h3>Finance</h3><p>Review GST invoices, payments and outstanding receivables.</p></div></div></>; }
function Shell({ session, logout }: { session: Session; logout: () => void }) {
  const items = nav.filter(item => item.roles.includes(session.role));
  const allowed = (path: string) => items.some(x => x.path === path);
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><strong>Order to Audit</strong><small>Operations console</small></div></div><nav>{items.map(({path,label,icon:Icon})=><NavLink key={path} to={path} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom"><span className="role-chip">{session.role}</span><button className="logout" onClick={logout}><LogOut size={17}/><span>Sign out</span></button></div></aside><main className="content"><header className="topbar"><span>Operations / {session.role.toLowerCase()}</span><span className="live-dot">API connected</span></header><div className="page"><Routes><Route path="/dashboard" element={<Dashboard role={session.role}/>}/><Route path="/new-order" element={allowed('/new-order')?<CreateOrder session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/orders" element={allowed('/orders')?<Orders session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/invoices" element={allowed('/invoices')?<Invoices session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/purchases" element={allowed('/purchases')?<PurchaseEntry session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/production" element={allowed('/production')?<ProductionEntry session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/production-report" element={allowed('/production-report')?<ProductionReport session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/stock-ledger" element={allowed('/stock-ledger')?<DataPage title="Stock movement ledger" path="/stock/ledger" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/stock" element={allowed('/stock')?<DataPage title="Current stock" path="/stock" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/receivables" element={allowed('/receivables')?<DataPage title="Receivables" path="/reports/receivables" session={session} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></div></main></div>;
}
export default function App() { const [session, setSession] = useState<Session | null>(null); return <BrowserRouter><Routes><Route path="/login" element={session?<Navigate to="/dashboard" replace/>:<Login onLogin={setSession}/>}/><Route path="/*" element={session?<Shell session={session} logout={()=>setSession(null)}/>:<Navigate to="/login" replace/>}/></Routes></BrowserRouter>; }
