const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Self-contained printable receipt (use the browser's Print to save as PDF) or downloadable .html file. */
export function receiptHtml(r) {
  const rows = r.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${esc(i.quantity)} ${esc(i.unit)}</td><td class="n">${Number(i.unit_price).toLocaleString()}</td><td class="n">${Number(i.line_total).toLocaleString()}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${esc(r.number)}</title><style>
  body{font:14px system-ui,sans-serif;max-width:640px;margin:32px auto;color:#0f172a;padding:0 16px}h1{color:#0f4c3a;margin:0}small{color:#64748b}
  table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}.n{text-align:right}
  .total{font-size:18px;font-weight:700}.note{margin-top:24px;padding:10px;background:#fef3c7;border-radius:8px;font-size:12px}</style></head><body>
  <h1>Debo Dairy</h1><small>Every batch checked, fairly priced.</small>
  <h2>Receipt ${esc(r.number)}</h2><p>Issued ${esc(new Date(r.issued_at).toLocaleString())}<br>Status: ${esc(String(r.status).replaceAll('_', ' '))}</p>
  <p><b>Buyer:</b> ${esc(r.buyer.name)} (${esc(r.buyer.email)})<br><b>Seller:</b> ${esc(r.seller.name)}${r.seller.phone ? ` (${esc(r.seller.phone)})` : ''}<br><b>Delivery address:</b> ${esc(r.delivery_address || 'Self pickup')}</p>
  <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="total">Total: ${esc(r.currency)} ${Number(r.total).toLocaleString()}</p>
  <p>Payment: ${esc(r.payment.method)} · ${esc(r.payment.status)}<br>Reference: ${esc(r.payment.reference || '-')}</p>
  <div class="note">${esc(r.note)}</div></body></html>`;
}

export function openReceipt(r, { print = false } = {}) {
  const html = receiptHtml(r);
  if (print) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `receipt-${r.number}.html` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
