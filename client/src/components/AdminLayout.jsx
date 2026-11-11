import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { cx, CowMark, Hero } from './ui.jsx';
import Assistant from './Assistant.jsx';

const LINKS = [['/admin', 'Dashboard', true], ['/admin/users', 'Users'], ['/admin/products', 'Products'], ['/admin/orders', 'Orders'], ['/admin/deliveries', 'Deliveries'], ['/admin/disputes', 'Disputes'], ['/admin/reviews', 'Reviews'], ['/admin/settings', 'Pricing & model'], ['/admin/audit', 'Audit']];

/** Independent administrator shell: its own top navigation bar, separate from the user-facing app. */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const link = ({ isActive }) => cx('whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition', isActive ? 'bg-white/15 font-medium text-white' : 'text-brand-100 hover:bg-white/10');
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-brand-800 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <NavLink to="/admin" className="flex items-center gap-2.5">
            <CowMark size={38} />
            <span className="leading-tight">
              <span className="block font-semibold">Debo Dairy</span>
              <span className="block text-[11px] uppercase tracking-wider text-brand-200">Admin console</span>
            </span>
          </NavLink>
          <nav className="ml-4 hidden flex-1 items-center gap-0.5 xl:flex" aria-label="Admin">
            {LINKS.map(([to, label, end]) => <NavLink key={to} to={to} end={end} className={link}>{label}</NavLink>)}
          </nav>
          <div className="ml-auto hidden items-center gap-3 xl:flex">
            <NavLink to="/admin/profile" className="text-right text-xs leading-tight text-brand-100 hover:text-white">
              <span className="block font-medium text-white">{user.full_name}</span>Administrator
            </NavLink>
            <button onClick={logout} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Log out</button>
          </div>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu" className="ml-auto rounded px-2 py-1 text-xl hover:bg-white/10 xl:hidden">☰</button>
        </div>
        {open && (
          <nav className="border-t border-white/10 px-4 pb-3 pt-2 xl:hidden" aria-label="Admin">
            <div className="grid gap-1">
              {[...LINKS, ['/admin/profile', 'My profile']].map(([to, label, end]) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={link}>{label}</NavLink>)}
              <button onClick={logout} className="mt-1 rounded-lg bg-white/10 px-3 py-2 text-left text-sm">Log out</button>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-8">
        {pathname === '/admin' && <Hero title={`Welcome, ${user.full_name.split(' ')[0]}`} subtitle="Monitor trade, quality and escrow, resolve disputes and keep the Milk Check model calibrated." />}
        <Outlet />
      </main>
      <Assistant />
    </div>
  );
}
