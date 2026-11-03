// n8n Code node «Build AI Request» — Run Once for All Items.
// Вхід: items з «Get Inputs» (рядки листа Inputs цієї пачки) АБО, на кроці review, одне нове повідомлення.
// Вихід: { body } — готове тіло для HTTP Request до OpenAI (поле JSON = {{ $json.body }}), плюс службові поля.
// Чому тіло збираємо в коді: так ніякі лапки й переноси в документах не ламають JSON (урок про ={{ }}).

const cfg = $('Template Config').first().json;
const session = $('Get Session').first().json;
const role = session.role || '';
const coKey = role.startsWith('uts') ? 'uts' : 'automov';
const co = cfg.OUR[coKey];
const side = role.endsWith('_z') ? 'z' : role.endsWith('_p') ? 'p' : 'both';
const mode = session.step === 'review' ? 'patch' : 'extract';

const MAX = 300000;
let bundle = '', count = 0, cut = false;
if (mode === 'extract') {
  for (const it of $input.all()) {
    const r = it.json;
    if (String(r.batch_id) !== String(session.batch_id) || !String(r.text || '').trim()) continue;
    count++;
    const block = `=== Документ ${count} (${r.kind}${r.name ? ': ' + r.name : ''}) ===\n${String(r.text).trim()}\n\n`;
    if (bundle.length + block.length > MAX) { cut = true; break; }
    bundle += block;
  }
} else {
  bundle = String($('Normalize Text').first().json.userText || '').trim();
  count = 1;
}

let current = {};
try { current = JSON.parse(session.data || '{}'); } catch (e) { current = {}; }

const keys = Object.keys(cfg.FIELDS);
const sideRule = {
  z: 'Тип договору: з ЗАМОВНИКОМ. Усі сторонні компанії за замовчуванням — замовник (CLIENT_*). CARRIER_* заповнюй лише якщо в тексті явно сказано «перевізник».',
  p: 'Тип договору: заявка ПЕРЕВІЗНИКУ. Усі сторонні компанії за замовчуванням — перевізник (CARRIER_*). CLIENT_* заповнюй лише якщо в тексті явно сказано «замовник».',
  both: 'Тип: ОБИДВА договори. Визнач сторону кожної компанії за мітками «Замовник/Перевізник» і за змістом: хто платить за перевезення — замовник; чиє авто, водій, техпаспорт, посвідчення — перевізник. Якщо сторону визначити не можна — НЕ вгадуй, додай компанію в unassigned.',
}[side];

const system = [
  'Ти — асистент логіста в Україні. Із документів (виписки, реквізити, заявки, фото техпаспорта й посвідчення, голосові) заповни поля договору.',
  `ЕКСПЕДИТОР — це ми: ${co.text}. НІКОЛИ не записуй експедитора в CLIENT_* чи CARRIER_*. Менеджер експедитора: ${cfg.MANAGER} — це EXPEDITOR_CONTACT, не контакт сторін.`,
  sideRule,
  'Правила: назви повністю великими як у виписці («ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «…»», «ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ …»). ПІБ — повністю. ЄДРПОУ — 8 цифр, у ФОП РНОКПП — 10 цифр. IBAN — лише цифри без UA і пробілів. Цифри переписуй точно, нічого не округлюй.',
  'ФОП не має директора й статуту: *_DIRECTOR = ПІБ самого ФОП, *_BASIS = «Виписки з ЄДР». ТОВ: *_BASIS = «Статуту», якщо не сказано інше.',
  'CONTRACT_NUMBER — номер угоди в CRM, якщо його названо (лише цифри). Це і є номер договору.',
  'CARRIER_TAX — податковий статус перевізника, напр. «Платник єдиного податку 3 групи (5%)» або «Платник ПДВ».',
  'ROUTE у форматі «м. Київ - м. Львів» (префікси м., с., смт). Ціни (SERVICE_PRICE, TRANSPORT_PRICE, CARGO_VALUE) — лише цифри в грн. Дати — ДД.ММ.РРРР, час якщо є.',
  'Рейс внутрішній → CUSTOMS_LOADING, BORDER_POINT, CUSTOMS_UNLOADING = порожні.',
  'Якщо одне поле має РІЗНІ значення в різних документах — у поле запиши найнадійніше (виписка > реквізити > рахунок > фото), а всі варіанти додай у conflicts.',
  'Поле не знайдено — порожній рядок. Не вигадуй. Важливе, що не лягло в поля, коротко — в notes.',
  mode === 'patch'
    ? 'РЕЖИМ ВИПРАВЛЕННЯ. Тобі дано поточні дані (JSON) і нове повідомлення користувача. Зміни ЛИШЕ те, що просить або додає повідомлення; решту поверни без змін. conflicts і unassigned — порожні, якщо повідомлення їх не стосується.'
    : '',
].filter(Boolean).join('\n');

const user = mode === 'patch'
  ? `ПОТОЧНІ ДАНІ:\n${JSON.stringify(current)}\n\nНОВЕ ПОВІДОМЛЕННЯ:\n${bundle}`
  : bundle;

const props = {};
keys.forEach(k => { props[k] = { type: 'string' }; });
props.conflicts = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'options'],
  properties: { field: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } } };
props.unassigned = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'edrpou'],
  properties: { name: { type: 'string' }, edrpou: { type: 'string' } } } };
props.notes = { type: 'string' };

const body = {
  model: 'gpt-4.1-mini',
  temperature: 0,
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  response_format: { type: 'json_schema', json_schema: { name: 'contract_data', strict: true,
    schema: { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props } } },
};

return [{ json: { body, mode, count, cut, chars: bundle.length, empty: !bundle } }];
