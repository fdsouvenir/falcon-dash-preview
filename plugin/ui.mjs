const escape = (value) =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
export function render(module, data) {
	const names = {
		work: 'Work',
		integrations: 'Integrations',
		vault: 'Vault',
		documents: 'Documents'
	};
	const rows =
		module === 'work'
			? (data.items ?? [])
			: module === 'integrations'
				? (data.connections ?? [])
				: module === 'vault'
					? (data.entries ?? [])
					: (data.roots ?? []);
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${names[module]} · Falcon Dash</title><style>
 :root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif;background:#191918;color:#ece9df}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,3vw,40px);max-width:1200px;margin-inline:auto}h1{font-size:28px;margin:0 0 8px}h2{font-size:18px}p{color:#b8b7ac;max-width:75ch}header{border-bottom:1px solid #45443e;padding-bottom:20px;margin-bottom:24px}.notice{border-left:3px solid #dca956;padding:12px 16px;background:#26251f;margin:18px 0}.rows{border:1px solid #45443e;border-radius:10px;overflow:hidden}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:18px;border-bottom:1px solid #383831}.row:last-child{border:0}.title{font-weight:650;overflow-wrap:anywhere}.detail{font-size:13px;color:#b8b7ac;overflow-wrap:anywhere}.state{max-width:180px;color:#dca956;overflow-wrap:anywhere}.empty{padding:24px}code{overflow-wrap:anywhere}a{color:#e4b660}:focus-visible{outline:2px solid #e4b660;outline-offset:4px}@media(max-width:480px){.row{grid-template-columns:1fr}.state{max-width:100%}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
 </style><body><header><h1>${names[module]}</h1><p>Falcon Dash</p></header>
 <div class="notice" role="status">This sandboxed preview is read-only. Open the native Falcon pages in Control UI. If unavailable, enable Settings → Labs → Custom plugin UI and reload after the Gateway restart. This fallback never receives Gateway credentials.</div>
 ${data.error ? `<p role="alert">${escape(data.error)}</p>` : ''}
 ${module === 'vault' ? '<p>Values stay in protected KeePassXC storage. Use the native Vault page for protected entry, Reveal, Hide and Copy. Ordinary tools never return values.</p>' : ''}
 <section aria-label="${names[module]} records" class="rows">${rows.length ? rows.map((row) => `<article class="row"><div><div class="title">${escape(row.title ?? row.purpose ?? row.id)}</div><div class="detail">${escape(row.type ?? row.provider ?? '')} ${escape(row.id)}</div>${row.attention?.length ? `<div class="detail">${row.attention.map((w) => escape(w.code)).join(' · ')}</div>` : ''}</div><div class="state">${escape(row.status ?? row.health ?? '')}</div></article>`).join('') : '<p class="empty">No records available in this view.</p>'}</section>
 </body></html>`;
}
