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
let sides = false;
if (mode === 'extract') {
  // kind = «pdf» або «pdf:client» / «pdf:carrier» — сторону менеджер задає кнопкою «🚚 Далі: перевізник» (режим «Обидва»)
  const rows = $input.all().map(it => it.json)
    .filter(r => String(r.batch_id) === String(session.batch_id) && String(r.text || '').trim());
  const sideOf = r => String(r.kind || '').split(':')[1] || '';
  sides = rows.some(r => sideOf(r));
  const groups = sides
    ? [['client', '##### ДОКУМЕНТИ ЗАМОВНИКА #####'], ['carrier', '##### ДОКУМЕНТИ ПЕРЕВІЗНИКА #####'], ['', '##### ІНШЕ #####']]
    : [['', '']];
  outer: for (const [g, title] of groups) {
    const part = rows.filter(r => (sides ? sideOf(r) === g : true));
    if (!part.length) continue;
    if (title) bundle += title + '\n\n';
    for (const r of part) {
      count++;
      const block = `=== Документ ${count} (${String(r.kind).split(':')[0]}${r.name ? ': ' + r.name : ''}) ===\n${String(r.text).trim()}\n\n`;
      if (bundle.length + block.length > MAX) { cut = true; break outer; }
      bundle += block;
    }
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
}[side] + (sides
  ? '\nДокументи РОЗДІЛЕНІ менеджером заголовками «ДОКУМЕНТИ ЗАМОВНИКА» / «ДОКУМЕНТИ ПЕРЕВІЗНИКА» — це точний поділ: компанія з розділу замовника → CLIENT_*, з розділу перевізника → CARRIER_*. Явні мітки в тексті («Перевізник: …», «Замовник: …») мають пріоритет. Ціни, маршрут, вантаж, авто й водій можуть бути в будь-якому розділі.'
  : '');

const system = [
  'Ти — асистент логіста в Україні. Із документів (виписки, реквізити, заявки, фото техпаспорта й посвідчення, голосові) заповни поля договору.',
  `ЕКСПЕДИТОР — це ми: ${co.text}. НІКОЛИ не записуй експедитора в CLIENT_* чи CARRIER_*. Менеджер експедитора: ${cfg.MANAGER} — це EXPEDITOR_CONTACT, не контакт сторін.`,
  sideRule,
  'Правила: назви повністю великими як у виписці («ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «…»», «ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ …»). ПІБ — повністю. ЄДРПОУ — 8 цифр, у ФОП РНОКПП — 10 цифр. IBAN — повністю, як у документі: «UA» і 27 цифр (перші 2 цифри після UA — контрольні, їх НЕ пропускай), без пробілів. Цифри переписуй точно, нічого не округлюй.',
  'ФОП не має директора й статуту: *_DIRECTOR = ПІБ самого ФОП, *_BASIS = «Виписки з ЄДР». ТОВ: *_BASIS = «Статуту», якщо не сказано інше.',
  'CONTRACT_NUMBER — номер угоди в CRM, якщо його названо (лише цифри). Це і є номер договору.',
  'CARRIER_TAX — податковий статус перевізника, напр. «Платник єдиного податку 3 групи (5%)» або «Платник ПДВ». Обовʼязково вкажи, чи є реєстрація ПДВ: «…, платник ПДВ» або «…, без ПДВ». Якщо серед документів перевізника є «Витяг з реєстру платників податку на додану вартість» або написано «із реєстрацією ПДВ» — він платник ПДВ.',
  'ROUTE у форматі «м. Київ - м. Львів» (префікси м., с., смт). Ціни (SERVICE_PRICE, TRANSPORT_PRICE, CARGO_VALUE) — лише цифри в грн. Дати — ДД.ММ.РРРР, час якщо є.',
  'Рейс внутрішній → CUSTOMS_LOADING, BORDER_POINT, CUSTOMS_UNLOADING = порожні.',
  'Якщо одне поле має РІЗНІ значення в різних документах — у поле запиши найнадійніше (виписка > реквізити > рахунок > фото), а всі варіанти додай у conflicts.',
  'SERVICE_PRICE — ціна для замовника, TRANSPORT_PRICE — плата перевізнику. Якщо названо одну ціну без уточнення: у договорі з замовником це SERVICE_PRICE, у заявці перевізнику — TRANSPORT_PRICE. Не дублюй одну ціну в обидва поля.',
  'Умови й строки оплати НЕ записуй нікуди (порядок оплати вже надрукований у шаблоні). EXTRA_CONDITIONS — лише якщо користувач прямо каже «додаткові умови»; інакше порожньо.',
  'Поле не знайдено — порожній рядок. Не вигадуй. notes — лише важливе, чого НЕМАЄ в полях (не повторюй знайдені дані), до 200 символів; якщо такого немає — порожньо.',
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
