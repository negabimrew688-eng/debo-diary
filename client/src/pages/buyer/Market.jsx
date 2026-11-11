import { useState } from 'react';
import { cx, PageHeader } from '../../components/ui.jsx';
import Products from './Products.jsx';
import Marketplace from './Marketplace.jsx';

export default function Market() {
  const [tab, setTab] = useState('products');
  const T = [['products', 'Dairy products'], ['milk', 'Raw milk batches']];
  return (
    <>
      <PageHeader title="Marketplace" subtitle="Dairy products from farms, and graded raw milk with escrow protection" />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {T.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>{l}</button>)}
      </div>
      {tab === 'products' ? <Products /> : <Marketplace />}
    </>
  );
}
