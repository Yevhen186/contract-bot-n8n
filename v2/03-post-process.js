// n8n Code node «Post-process» — Run Once for All Items. Без ШІ: усе детерміновано.
// Вхід: відповідь HTTP Request «OpenAI Extract» (chat/completions).
// Вихід: { data, dataJson, missing, warnings, conflicts, unassigned, notes, docs } — далі в «Save Session» і «Review Screen».

const cfg = $('Template Config').first().json;
const session = $('Get Session').first().json;
const role = session.role || '';
const coKey = role.startsWith('uts') ? 'uts' : 'automov';
const co = cfg.OUR[coKey];

// --- відповідь моделі ---
const resp = $input.first().json;
let out = {};
try { out = JSON.parse(resp.choices[0].message.content); }
catch (e) { return [{ json: { error: 'Не вдалося прочитати відповідь ШІ. Спробуйте ще раз.' } }]; }

let prev = {};
try { prev = JSON.parse(session.data || '{}'); } catch (e) { prev = {}; }

const data = {};
for (const k of Object.keys(cfg.FIELDS)) {
  const v = String(out[k] ?? '').replace(/\s+/g, ' ').trim();
  data[k] = v || String(prev[k] || '');   // нове порожнє не стирає вже відоме
}

// --- перевірки кодів ---
function edrpouOk(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const d = [...s].map(Number), n = +s;
  const w1 = (n < 30000000 || n > 60000000) ? [1, 2, 3, 4, 5, 6, 7] : [7, 1, 2, 3, 4, 5, 6];
  let c = w1.reduce((a, w, i) => a + w * d[i], 0) % 11;
  if (c >= 10) { const w2 = w1.map(w => w + 2); c = w2.reduce((a, w, i) => a + w * d[i], 0) % 11; if (c >= 10) c = 0; }
  return c === d[7];
}
function rnokppOk(s) {
  if (!/^\d{10}$/.test(s)) return false;
  const d = [...s].map(Number), w = [-1, 5, 7, 9, 4, 6, 10, 5, 7];
  return (w.reduce((a, x, i) => a + x * d[i], 0) % 11) % 10 === d[9];
}
function ibanNorm(s) { s = String(s || '').replace(/\s/g, '').toUpperCase(); if (/^\d{27}$/.test(s)) s = 'UA' + s; return s; }
function ibanOk(s) {
  s = ibanNorm(s); if (!/^UA\d{27}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
  let m = 0; for (const ch of r) m = (m * 10 + +ch) % 97; return m === 1;
}
const codeOk = v => (v.length === 8 ? edrpouOk(v) : v.length === 10 ? rnokppOk(v) : false);

const warnings = [];
for (const p of ['CLIENT', 'CARRIER']) {
  const who = p === 'CLIENT' ? 'замовника' : 'перевізника';
  const code = data[p + '_EDRPOU'].replace(/\D/g, '');
  if (data[p + '_EDRPOU']) { data[p + '_EDRPOU'] = code; if (!codeOk(code)) warnings.push(`Код ${who} ${code} не проходить перевірку — перевірте цифри`); }
  if (data[p + '_IBAN']) {
    const ib = ibanNorm(data[p + '_IBAN']);
    // у шаблонах IBAN без UA (як у v1)
    data[p + '_IBAN'] = ib.replace(/^UA/, '');
    if (!ibanOk(ib)) warnings.push(`IBAN ${who} не проходить контрольну суму — найчастіше одна цифра розпізнана неправильно`);
  }
  const name = data[p + '_COMPANY'];
  if (/ФІЗИЧНА ОСОБА|^ФОП/i.test(name)) {
    if (/статут/i.test(data[p + '_BASIS'])) data[p + '_BASIS'] = 'Виписки з ЄДР';
    if (!data[p + '_DIRECTOR']) data[p + '_DIRECTOR'] = name.replace(/ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ|ФОП/i, '').trim();
    if (!data[p + '_IPN'] && code.length === 10) data[p + '_IPN'] = code;
  }
  // експедитора не пускаємо в сторони
  if (code === co.edrpou) { warnings.push(`У ${who} потрапили наші реквізити (${co.short}) — поля ${who} очищено`);
    Object.keys(data).filter(k => k.startsWith(p + '_')).forEach(k => { data[k] = ''; }); }
}

// --- короткі форми (одна функція замість трьох копій v1) ---
const shortCo = s => s.replace('ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ', 'ТОВ').replace('ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ', 'ФОП').replace('ПРИВАТНЕ ПІДПРИЄМСТВО', 'ПП').trim();
const shortName = s => { const p = s.trim().split(/\s+/); return p.length >= 3 ? `${p[0]} ${p[1][0]}.${p[2][0]}.` : s; };
data.CLIENT_COMPANY_SHORT = shortCo(data.CLIENT_COMPANY);
data.CLIENT_DIRECTOR_SHORT = shortName(data.CLIENT_DIRECTOR);
data.CARRIER_COMPANY_SHORT = shortCo(data.CARRIER_COMPANY);
data.CARRIER_DIRECTOR_SHORT = shortName(data.CARRIER_DIRECTOR);

// --- гроші ---
for (const k of ['SERVICE_PRICE', 'TRANSPORT_PRICE', 'CARGO_VALUE']) data[k] = data[k].replace(/[^\d.,]/g, '').replace(',', '.').replace(/\.0+$/, '');
const z = +data.SERVICE_PRICE || 0, p = +data.TRANSPORT_PRICE || 0;
if (z && p) {
  const net = co.vat ? z / 1.2 : z;
  const m = (net - p) / net * 100;
  if (m < 0) warnings.push(`Збиток: перевізнику ${p} грн більше, ніж отримуємо від замовника`);
  else if (m < 8) warnings.push(`Маржа лише ${m.toFixed(1)}% (типова — 13%)`);
}

// --- міжнародний рейс ---
const intl = !!(data.CUSTOMS_LOADING || data.BORDER_POINT || data.CUSTOMS_UNLOADING);
if (intl && !co.intl) warnings.push(`${co.short} оформлює лише внутрішні перевезення — для міжнародного рейсу оберіть АвтоМув`);

// --- службові ---
const now = new Date(Date.now() + 2 * 3600e3); // Київ (без літнього часу — для дати договору достатньо)
const dd = n => String(n).padStart(2, '0');
data.CONTRACT_DATE = `${dd(now.getUTCDate())}.${dd(now.getUTCMonth() + 1)}.${now.getUTCFullYear()}`;
data.CONTRACT_NUMBER = data.CONTRACT_NUMBER.replace(/\D/g, '');  // № угоди в CRM = № договору
data.TRANSPORT_TYPE = 'Вантажоперевезення';
data.EXPEDITOR_CONTACT = data.EXPEDITOR_CONTACT || cfg.MANAGER;

// --- чого бракує по кожному шаблону ---
const docs = (cfg.ROLE_DOCS[role] || []).map(id => {
  const t = cfg.TEMPLATES[id];
  const req = [...t.required, ...(intl ? cfg.INTL_REQ : [])];
  const miss = req.filter(k => !data[k]);
  if (!data.CONTRACT_NUMBER) miss.unshift('CONTRACT_NUMBER');
  return { id, title: t.title, side: t.side, missing: miss };
});
const missing = [...new Set(docs.flatMap(d => d.missing))];

const conflicts = (out.conflicts || []).filter(c => c.options && new Set(c.options).size > 1);
const unassigned = out.unassigned || [];

return [{ json: {
  data, dataJson: JSON.stringify(data), docs, missing, warnings, conflicts, unassigned,
  notes: String(out.notes || '').trim(), intl,
} }];
