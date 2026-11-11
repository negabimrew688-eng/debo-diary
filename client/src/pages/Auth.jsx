import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Btn, CowMark, ErrorBox, Field, Input, Select, useAction } from '../components/ui.jsx';
import { homeFor } from '../components/Layout.jsx';

const Shell = ({ title, subtitle, children }) => (
  <div className="min-h-screen lg:grid lg:grid-cols-2">
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 p-10 text-white lg:flex lg:flex-col">
      <div className="flex items-center gap-3"><CowMark size={48} /><div className="text-xl font-semibold">Debo Dairy</div></div>
      <div className="relative z-10 mt-16 max-w-md">
        <h1 className="text-4xl font-semibold leading-tight">Every batch checked, fairly priced.</h1>
        <p className="mt-4 text-brand-100">Ethiopia's dairy marketplace: farmers, buyers, feed suppliers and transporters on one platform, with Milk Check screening and Telebirr escrow.</p>
        <ul className="mt-6 space-y-2 text-sm text-brand-100">
          <li>✓ Milk quality graded before it is sold</li>
          <li>✓ Payment held until delivery is checked</li>
          <li>✓ Feed advice and transport in one place</li>
        </ul>
      </div>
      <img src="/cow.png" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-10 h-[62%] w-auto select-none drop-shadow-2xl" />
    </aside>
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3 lg:hidden"><CowMark size={44} className="!bg-brand-100" /><div className="text-2xl font-semibold text-brand-800">Debo Dairy</div></div>
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mb-5 mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  </div>
);

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const { busy, error, run } = useAction();
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const submit = (e) => { e.preventDefault(); run(async () => { const u = await login(f.email, f.password); nav(homeFor(u.role)); }); };
  return (
    <Shell title="Welcome back" subtitle="Log in with your email and password. Administrators sign in here too.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorBox>{error}</ErrorBox>
        <Btn type="submit" disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Log in'}</Btn>
        <p className="text-center text-sm text-slate-500">New here? <Link to="/register" className="font-medium text-brand-700 hover:underline">Create an account</Link></p>
      </form>
    </Shell>
  );
}

const ROLES = [['farmer', 'Milk producer / farmer'], ['buyer', 'Milk buyer / processor'], ['feed_supplier', 'Cow-feed supplier'], ['transporter', 'Milk transporter']];

export function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ role: 'farmer', full_name: '', email: '', phone: '', password: '', region: '', woreda: '', buyer_type: 'individual', org_name: '', business_name: '', company_name: '', vehicle_type: '', capacity_litres: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = (e) => {
    e.preventDefault();
    const profile = {
      farmer: { farm_name: f.org_name || undefined },
      buyer: { buyer_type: f.buyer_type, org_name: f.org_name || undefined },
      feed_supplier: { business_name: f.business_name || undefined },
      transporter: { company_name: f.company_name || undefined, vehicle_type: f.vehicle_type || undefined, capacity_litres: f.capacity_litres ? Number(f.capacity_litres) : undefined, service_area: f.region || undefined },
    }[f.role];
    run(async () => {
      const u = await register({ role: f.role, full_name: f.full_name, email: f.email, phone: f.phone || undefined, password: f.password, region: f.region || undefined, woreda: f.woreda || undefined, profile });
      nav(homeFor(u.role));
    });
  };
  return (
    <Shell title="Create your account" subtitle="Free for farmers, buyers, feed suppliers and transporters.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="I am a"><Select value={f.role} onChange={set('role')}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Full name"><Input required value={f.full_name} onChange={set('full_name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input type="email" required value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone" hint="e.g. +251911000000 (used for USSD)"><Input value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Region"><Input value={f.region} onChange={set('region')} placeholder="Amhara" /></Field>
          <Field label="Woreda / town"><Input value={f.woreda} onChange={set('woreda')} placeholder="Gondar Zuria" /></Field>
        </div>
        {f.role === 'farmer' && <Field label="Farm name (optional)"><Input value={f.org_name} onChange={set('org_name')} /></Field>}
        {f.role === 'buyer' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buyer type"><Select value={f.buyer_type} onChange={set('buyer_type')}><option value="individual">Individual</option><option value="processor">Dairy processor</option><option value="collection_centre">Milk collection centre</option></Select></Field>
            <Field label="Organisation"><Input value={f.org_name} onChange={set('org_name')} /></Field>
          </div>
        )}
        {f.role === 'feed_supplier' && <Field label="Business name"><Input value={f.business_name} onChange={set('business_name')} /></Field>}
        {f.role === 'transporter' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Company"><Input value={f.company_name} onChange={set('company_name')} /></Field>
            <Field label="Vehicle"><Input value={f.vehicle_type} onChange={set('vehicle_type')} /></Field>
            <Field label="Capacity (L)"><Input type="number" min="1" value={f.capacity_litres} onChange={set('capacity_litres')} /></Field>
          </div>
        )}
        <Field label="Password" hint="At least 8 characters with a letter and a digit"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <ErrorBox>{error}</ErrorBox>
        <Btn type="submit" disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create account'}</Btn>
        <p className="text-center text-sm text-slate-500">Already registered? <Link to="/login" className="font-medium text-brand-700 hover:underline">Log in</Link></p>
      </form>
    </Shell>
  );
}
