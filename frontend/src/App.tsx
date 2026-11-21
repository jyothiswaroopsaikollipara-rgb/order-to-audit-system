import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Factory, ShoppingCart } from 'lucide-react';
import './App.css';

type Role = 'ADMIN' | 'SALESMAN' | 'PRODUCTION' | 'AUDITOR' | 'OWNER';
type Session = { token: string; role: Role };
const roles: Role[] = ['ADMIN', 'SALESMAN', 'PRODUCTION', 'AUDITOR', 'OWNER'];
const nav = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles },
  { path: '/stock', label: 'Stock', icon: Package, roles: ['ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'] as Role[] },
  { path: '/receivables', label: 'Receivables', icon: Receipt, roles: ['ADMIN', 'AUDITOR', 'OWNER'] as Role[] },
];

async function api<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 401 ? 'Session expired. Please sign in again.' : `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(response.status === 401 ? 'Invalid email or password.' : `Login failed (${response.status}).`);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('token' in data) || !('role' in data) || typeof data.token !== 'string' || !roles.includes(data.role as Role)) throw new Error('Unexpected login response.');
      onLogin({ token: data.token, role: data.role as Role }); navigate('/dashboard', { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in.'); }
    finally { setLoading(false); }
  }
  return <main className="login-screen"><section className="login-card"><div className="brand-mark"><ShieldCheck size={27}/></div><p className="eyebrow">OPERATIONS PLATFORM</p><h1>Order to Audit</h1><p className="muted">Secure access to orders, production, inventory and finance.</p><form onSubmit={submit}><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@company.com"/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter your password"/>{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button></form><p className="fineprint">Access is limited to authorized personnel.</p></section></main>;
}

function DataPage({ title, path, token, onUnauthorized }: { title: string; path: string; token: string; onUnauthorized: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
  let active = true;

  api<Record<string, unknown>[]>(path, token)
    .then((data) => {
      if (active) {
        setRows(data);
      }
    })
    .catch((e: unknown) => {
      if (!active) return;

      const message =
        e instanceof Error ? e.message : 'Failed to load data';

      setError(message);

      if (message.includes('Session expired')) {
        onUnauthorized();
      }
    })
    .finally(() => {
      if (active) {
        setLoading(false);
      }
    });

  return () => {
    active = false;
  };
}, [path, token, onUnauthorized]);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return <section className="panel"><h2>{title}</h2>{loading ? <p className="muted">Loading…</p> : error ? <p className="error">{error}</p> : rows.length === 0 ? <p className="muted">No records found.</p> : <div className="table-wrap"><table><thead><tr>{keys.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{String(r[k] ?? '—')}</td>)}</tr>)}</tbody></table></div>}</section>;
}
function Dashboard({ role }: { role: Role }) { return <><div className="hero"><p className="eyebrow">WORKSPACE OVERVIEW</p><h2>Welcome back</h2><p className="muted">Signed in as {role.toLowerCase()}. Choose a section to view live operational data.</p></div><div className="tiles"><div className="tile"><ShoppingCart/><h3>Sales orders</h3><p>Order submission and approvals are the next milestone.</p></div><div className="tile"><Factory/><h3>Production</h3><p>Production runs, material usage and variance reporting.</p></div><div className="tile"><Receipt/><h3>Finance</h3><p>Invoice tracking, payments and receivables.</p></div></div></>; }
function Shell({ session, logout }: { session: Session; logout: () => void }) { const items = nav.filter(item => item.roles.includes(session.role)); return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><strong>Order to Audit</strong><small>Operations console</small></div></div><nav>{items.map(({path,label,icon:Icon})=><NavLink key={path} to={path} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={18}/>{label}</NavLink>)}</nav><div className="sidebar-bottom"><span className="role-chip">{session.role}</span><button className="logout" onClick={logout}><LogOut size={17}/> Sign out</button></div></aside><main className="content"><header className="topbar"><span>Operations / {session.role.toLowerCase()}</span><span className="live-dot">Connected to API</span></header><div className="page"><Routes><Route path="/dashboard" element={<Dashboard role={session.role}/>}/><Route path="/stock" element={items.some(x=>x.path==='/stock')?<DataPage title="Current stock" path="/stock" token={session.token} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="/receivables" element={items.some(x=>x.path==='/receivables')?<DataPage title="Receivables" path="/reports/receivables" token={session.token} onUnauthorized={logout}/>:<Navigate to="/dashboard" replace/>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></div></main></div>; }
export default function App() { const [session, setSession] = useState<Session | null>(null); return <BrowserRouter><Routes><Route path="/login" element={session?<Navigate to="/dashboard" replace/>:<Login onLogin={setSession}/>}/><Route path="/*" element={session?<Shell session={session} logout={()=>setSession(null)}/>:<Navigate to="/login" replace/>}/></Routes></BrowserRouter>; }
