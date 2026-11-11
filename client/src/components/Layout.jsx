import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Assistant from './Assistant.jsx';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { cx, CowMark, Hero } from './ui.jsx';

const NAV = {
  farmer: [['/farmer', 'Dashboard'], ['/farmer/batches', 'Milk batches'], ['/farmer/cows', 'My cows'], ['/farmer/products', 'My dairy products'], ['/farmer/product-orders', 'Product orders'], ['/farmer/feed', 'Feed & advice'], ['/farmer/byproducts', 'Compost & byproducts'], ['/orders', 'Milk orders & payments'], ['/notifications', 'Notifications', true]],
  buyer: [['/buyer', 'Dashboard'], ['/buyer/market', 'Marketplace'], ['/buyer/cart', 'Cart'], ['/buyer/orders', 'My orders'], ['/buyer/addresses', 'Delivery addresses'], ['/buyer/byproducts', 'Compost & byproducts'], ['/notifications', 'Notifications', true]],
  feed_supplier: [['/supplier', 'Demand & sales'], ['/supplier/products', 'My products'], ['/supplier/orders', 'Feed orders']],
  transporter: [['/delivery', 'Dashboard'], ['/delivery/assignments', 'Assignments'], ['/delivery/earnings', 'Earnings'], ['/notifications', 'Notifications', true]],
};
const WELCOME = {
  farmer: ['Your herd, your milk, your price', 'Check each batch, list it for buyers and get a fair grade-based price.'],
  buyer: ['Quality dairy, delivered', 'Browse milk and dairy products, pay with Telebirr and track every delivery.'],
  feed_supplier: ['Feed the farms that need you', 'See farmer demand by region and manage your products and orders.'],
  transporter: ['Deliveries on the road', 'Accept assignments, pick up, deliver with the buyer\'s code and track your earnings.'],
};
export const ROLE_LABEL = { farmer: 'Milk producer', buyer: 'Milk buyer', feed_supplier: 'Feed supplier', transporter: 'Delivery partner', admin: 'Administrator' };
export const homeFor = (role) => ({ farmer: '/farmer', buyer: '/buyer', feed_supplier: '/supplier', transporter: '/delivery', admin: '/admin' }[role] || '/login');

function useUnread() {
  const [n, setN] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/notifications/unread-count').then((r) => alive && setN(r.data.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);
  return n;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = NAV[user.role] || [];
  const unread = useUnread();
  const { pathname } = useLocation();
  const welcome = pathname === homeFor(user.role) ? WELCOME[user.role] : null;
  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between bg-brand-800 px-4 py-3 text-white md:hidden">
        <span className="flex items-center gap-2 font-semibold"><CowMark size={30} />Debo Dairy</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu" className="rounded px-2 py-1 hover:bg-brand-700">☰</button>
      </header>
      <aside className={cx('bg-brand-800 text-brand-50 md:block md:w-60 md:shrink-0', open ? 'block' : 'hidden')}>
        <div className="sticky top-0 flex h-full flex-col p-4 md:h-screen">
          <div className="hidden items-center gap-3 md:flex">
            <CowMark size={44} />
            <div>
              <div className="text-lg font-semibold leading-tight text-white">Debo Dairy</div>
              <div className="text-xs text-brand-200">Every batch checked, fairly priced.</div>
            </div>
          </div>
          <nav className="mt-4 flex-1 space-y-1">
            {links.map(([to, label, bell]) => (
              <NavLink key={to} to={to} end={to.split('/').length <= 2} onClick={() => setOpen(false)}
                className={({ isActive }) => cx('block rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-700 font-medium text-white' : 'text-brand-100 hover:bg-brand-700/60')}>
                {label}{bell && unread > 0 && <span className="ml-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-brand-900">{unread}</span>}
              </NavLink>
            ))}
            <NavLink to="/profile" onClick={() => setOpen(false)} className={({ isActive }) => cx('block rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-700 font-medium text-white' : 'text-brand-100 hover:bg-brand-700/60')}>My profile</NavLink>
          </nav>
          <div className="mt-4 border-t border-brand-700 pt-3 text-xs">
            <div className="truncate font-medium text-white">{user.full_name}</div>
            <div className="text-brand-200">{ROLE_LABEL[user.role]}</div>
            <button onClick={logout} className="mt-2 rounded bg-brand-700 px-3 py-1 text-white hover:bg-brand-600">Log out</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          {welcome && <Hero title={`Welcome, ${user.full_name.split(' ')[0]}`} subtitle={welcome[1]} />}
          <Outlet />
        </div>
      </main>
      <Assistant />
    </div>
  );
}
