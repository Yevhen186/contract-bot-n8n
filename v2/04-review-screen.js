// n8n Code node «Review Screen» — Run Once for All Items.
// Вхід: вихід «Post-process». Вихід: { text } для Telegram «Send Review» (без parse mode, з inline-кнопками
// «🚀 Генерувати» = callback gen і «❌ Скасувати» = callback cancel — вони статичні, налаштовуються в самому вузлі).
// Конфлікти й «чия це компанія» не мають окремих кнопок: користувач відповідає голосом/текстом, це йде в Patch.

const cfg = $('Template Config').first().json;
const r = $input.first().json;
if (r.error) return [{ json: { text: '⚠️ ' + r.error } }];

const d = r.data, F = cfg.FIELDS;
const session = $('Get Session').first().json;
const cut = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const show = (k, label) => d[k] ? `${label || F[k]}: ${cut(d[k])}` : null;
const tail = s => (s ? '…' + s.slice(-4) : '');

const coKey = (session.role || '').startsWith('uts') ? 'uts' : 'automov';
const roleTxt = { z: 'договір із замовником', p: 'заявка перевізнику' };
const docsTxt = r.docs.map(x => roleTxt[x.side]).join(' + ');
const req = new Set(r.docs.flatMap(x => cfg.TEMPLATES[x.id].required));
const found = [...req].filter(k => d[k]).length;

const L = [];
L.push(`📋 ${cfg.OUR[coKey].short} → ${docsTxt}`);
L.push(d.CONTRACT_NUMBER
  ? `№ угоди: ${d.CONTRACT_NUMBER}  ·  знайдено ${found} з ${req.size}`
  : `⚠️⚠️ № УГОДИ НЕ ВКАЗАНО — напишіть «угода 62811450»
Знайдено ${found} з ${req.size}`);

const sides = r.docs.map(x => x.side);
if (sides.includes('z')) {
  L.push('', 'ЗАМОВНИК');
  [show('CLIENT_COMPANY_SHORT', 'Назва'), d.CLIENT_EDRPOU && `ЄДРПОУ: ${d.CLIENT_EDRPOU}   IBAN: ${tail(d.CLIENT_IBAN)}`,
    show('CLIENT_DIRECTOR', 'Директор'), show('CLIENT_PHONE', 'Телефон')].filter(Boolean).forEach(x => L.push(x));
}
L.push('', 'РЕЙС');
[show('ROUTE'), show('CARGO_INFO'),
  (d.LOADING_DATE || d.LOADING_ADDRESS) && `Завантаження: ${cut([d.LOADING_DATE, d.LOADING_ADDRESS].filter(Boolean).join(', '))}`,
  (d.DELIVERY_DATE || d.UNLOADING_ADDRESS) && `Доставка: ${cut([d.DELIVERY_DATE, d.UNLOADING_ADDRESS].filter(Boolean).join(', '))}`,
  show('VEHICLE_INFO', 'Авто'), show('DRIVER_INFO', 'Водій')].filter(Boolean).forEach(x => L.push(x));
if (sides.includes('p')) {
  L.push('', 'ПЕРЕВІЗНИК');
  [show('CARRIER_COMPANY_SHORT', 'Назва'), d.CARRIER_EDRPOU && `Код: ${d.CARRIER_EDRPOU}   IBAN: ${tail(d.CARRIER_IBAN)}`,
    show('CARRIER_TAX', 'Податки'), show('CARRIER_PHONE', 'Телефон')].filter(Boolean).forEach(x => L.push(x));
}
const money = n => Number(n).toLocaleString('uk-UA') + ' грн';
const z = +d.SERVICE_PRICE || 0, p = +d.TRANSPORT_PRICE || 0;
if (z || p) {
  L.push('', 'ГРОШІ');
  if (z) L.push(`Замовник: ${money(z)}${d.CLIENT_TERMS ? ', ' + cut(d.CLIENT_TERMS, 50) : ''}`);
  if (p) L.push(`Перевізник: ${money(p)}${d.CARRIER_TERMS ? ', ' + cut(d.CARRIER_TERMS, 50) : ''}`);
  if (z && p) L.push(`Маржа: ${money(z - p)}`);
}

if (r.missing.length) L.push('', '❗ Не знайдено: ' + r.missing.map(k => F[k] || k).join(', '));
r.conflicts.forEach(c => L.push(`⚠️ ${F[c.field] || c.field}: різні значення — ${c.options.map(o => cut(o, 45)).join(' / ')}. Скажіть, яке правильне.`));
r.unassigned.forEach(u => L.push(`❓ ${cut(u.name, 50)}${u.edrpou ? ' (' + u.edrpou + ')' : ''} — це замовник чи перевізник?`));
r.warnings.forEach(w => L.push('⚠️ ' + w));
if (r.notes) L.push('ℹ️ ' + cut(r.notes, 300));

L.push('', r.missing.length
  ? 'Надішліть голосом або текстом, що додати чи змінити. Можна також фото або файл.'
  : 'Усе на місці. Натисніть «🚀 Генерувати» або надішліть, що змінити.');

let text = L.join('\n');
if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
return [{ json: { text, canGenerate: r.missing.length === 0 } }];
