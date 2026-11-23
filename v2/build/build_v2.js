// Builds Contract Bot v2 + Contract Generate JSON from v1 export and cb/v2/*.js
// usage: node build_v2.js <SUBWF_ID or PLACEHOLDER>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SP = __dirname;  // сюди ж пишемо v2_main.json і v2_generate.json
const CB = path.join(__dirname, '..');
const v1 = require(path.join(SP, 'contract_mapped.json'));
const SUBWF_ID = process.argv[2] || 'SUBWF_ID';

const uuid = () => crypto.randomUUID();
const code = f => fs.readFileSync(path.join(CB, f), 'utf8');
const clone = o => JSON.parse(JSON.stringify(o));
const v1n = name => { const n = v1.nodes.find(x => x.name === name); if (!n) throw new Error('no ' + name); return clone(n); };

// Єдиний робочий бот — «Contract Test» (старий «Contract» видалено після злому Railway)

const TG = { telegramApi: { id: 'pqP6Cx5iK8U94yL5', name: 'Contract Test' } };
const GS = { googleSheetsOAuth2Api: { id: 'xBCPRBZqnXGQGHi3', name: 'Google Sheets account 2' } };
const GD = { googleDriveOAuth2Api: { id: '7tK2zBZfJopHGKcH', name: 'Google Drive account 2' } };
const GDOC = { googleDocsOAuth2Api: { id: 'wTSs6x8mbO10MKvo', name: 'Google Docs account' } };
const OAH = { httpHeaderAuth: { id: 'IwSWSzPmVWO2q3JO', name: 'OpenAI Header Auth' } };

const SHEET_ID = '1eGy8MVhbyuzcYZphzsqOukW7Y0OtVIEKqBE3d3ali8U';
const doc = { __rl: true, value: SHEET_ID, mode: 'id' };
const sheetUrl = gid => ({ __rl: true, value: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}`, mode: 'url' });
const SESS = sheetUrl(367681442), INPUTS = sheetUrl(113545343);
const SESS_COLS = ['chat_id', 'step', 'company', 'role', 'data', 'updated_at', 'raw_input', 'batch_id'];
const INPUT_COLS = ['chat_id', 'batch_id', 'kind', 'name', 'text', 'created_at'];
const schema = cols => cols.map(id => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));

const T = "$('Telegram Trigger').first().json";
const CHAT = `${T}.message?.chat?.id ?? ${T}.callback_query?.message?.chat?.id`;
const CB_DATA = `${T}.callback_query?.data`;

// ---------- helpers ----------
const nodes = [];
const conns = {};
function add(n) { n.id = n.id || uuid(); nodes.push(n); return n.name; }
function link(from, to, out = 0) {
  conns[from] = conns[from] || { main: [] };
  while (conns[from].main.length <= out) conns[from].main.push([]);
  conns[from].main[out].push({ node: to, type: 'main', index: 0 });
}
function ifNode(name, pos, expr) {
  return add({ name, type: 'n8n-nodes-base.if', typeVersion: 2.3, position: pos, parameters: {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      conditions: [{ id: uuid(), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' },
    looseTypeValidation: true, options: {} } });
}
function tg(name, pos, chatExpr, text, extra = {}) {
  return add({ name, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: pos, webhookId: uuid(), credentials: TG,
    parameters: { chatId: `={{ ${chatExpr} }}`, text, ...extra, additionalFields: { appendAttribution: false, parse_mode: 'HTML' } } });
}
function sessWrite(name, pos, op, values) {
  const value = {};
  for (const c of SESS_COLS) value[c] = values[c];
  return add({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: pos, credentials: GS, parameters: {
    operation: op, documentId: doc, sheetName: SESS,
    columns: { mappingMode: 'defineBelow', value, matchingColumns: ['chat_id'], schema: schema(SESS_COLS), attemptToConvertTypes: false, convertFieldsToString: false },
    options: { cellFormat: 'RAW' } } });
}
function sessRead(name, pos, chatExpr) {
  return add({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: pos, credentials: GS, alwaysOutputData: true,
    parameters: { documentId: doc, sheetName: SESS, filtersUI: { values: [{ lookupColumn: 'chat_id', lookupValue: `={{ ${chatExpr} }}` }] }, options: {} } });
}
function codeNode(name, pos, js) {
  return add({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: js } });
}
function copyV1(name, pos, patch = {}) {
  const n = v1n(name);
  delete n.id;
  n.position = pos;
  if (n.credentials?.telegramApi) n.credentials = TG;
  if (n.webhookId) n.webhookId = uuid();
  Object.assign(n.parameters, patch);
  return add(n);
}
const empty = { chat_id: '', step: '', company: '', role: '', data: '', updated_at: '={{ $now.toISO() }}', raw_input: '', batch_id: '' };
const inlineKb = rows => ({ replyMarkup: 'inlineKeyboard', inlineKeyboard: { rows: rows.map(r => ({ row: { buttons: r.map(([text, cb]) => ({ text, additionalFields: { callback_data: cb } })) } })) } });
const WELCOME_KB = inlineKb([[['🚛 АвтоМув', 'automov'], ['📋 ЮТС', 'uts']]]);
const roleKb = co => inlineKb([[['📄 Замовник (З)', `${co}_z`]], [['🚚 Перевізник (П)', `${co}_p`]], [['🔁 Обидва договори', `${co}_both`]]]);
const REPLY_KB = { replyMarkup: 'replyKeyboard', replyKeyboard: { rows: [{ row: { buttons: [{ text: '✅ Готово', additionalFields: {} }, { text: '❌ Скасувати', additionalFields: {} }] } }] },
  replyKeyboardOptions: { resize_keyboard: true } };
// «Обидва»: перемикач сторони. Поточна сторона — у колонці сесії raw_input ('' = замовник, 'carrier' = перевізник)
const BTN_CARRIER = '🚚 Далі: перевізник', BTN_CLIENT = '👤 Назад: замовник';
const sideKb = btn => ({ replyMarkup: 'replyKeyboard', replyKeyboard: { rows: [
  { row: { buttons: [{ text: btn, additionalFields: {} }] } },
  { row: { buttons: [{ text: '✅ Готово', additionalFields: {} }, { text: '❌ Скасувати', additionalFields: {} }] } }] },
  replyKeyboardOptions: { resize_keyboard: true } });
const REMOVE_KB ={ replyMarkup: 'replyKeyboardRemove', replyKeyboardRemove: { remove_keyboard: true } };

// ================= MAIN =================
// --- entry ---
add({ name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.3, position: [-1100, 0], webhookId: uuid(), credentials: TG,
  parameters: { updates: ['message', 'callback_query'], additionalFields: {} } });
codeNode('Template Config', [-880, 0], code('01-template-config.js').replace(
  /return \[\{ json: \{ FIELDS, OUR, MANAGER, INTL_REQ, TEMPLATES, ROLE_DOCS, RATES \} \}\];\s*$/,
  'return [{ json: { FIELDS, OUR, MANAGER, INTL_REQ, TEMPLATES, ROLE_DOCS, RATES }, pairedItem: { item: 0 } }];\n'));
if (!nodes[1].parameters.jsCode.includes('pairedItem')) throw new Error('template config return not patched');
link('Telegram Trigger', 'Template Config');
ifNode('Is Start Command', [-660, 0], `${T}.message?.text === '/start'`);
link('Template Config', 'Is Start Command');
sessWrite('Reset Session', [-440, -200], 'appendOrUpdate', { ...empty, chat_id: `={{ ${T}.message.chat.id }}`, step: 'choose_company' });
tg('Welcome After Reset', [-220, -200], CHAT, '👋 Вітаю! Це Contract Bot v2. Оберіть компанію для договору:', WELCOME_KB);
link('Is Start Command', 'Reset Session', 0); link('Reset Session', 'Welcome After Reset');
ifNode('Is Callback', [-440, 100], `!!${T}.callback_query?.id`);
link('Is Start Command', 'Is Callback', 1);

// --- callback branch ---
sessRead('Get Session (callback)', [-220, -600], `${T}.callback_query.message.chat.id`);
link('Is Callback', 'Get Session (callback)', 0);
const rule = (key, expr) => ({ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
  conditions: [{ id: uuid(), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  renameOutput: true, outputKey: key });
add({ name: 'Route Callback', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [0, -600], parameters: {
  rules: { values: [
    rule('Role', `['automov_z','automov_p','automov_both','uts_z','uts_p','uts_both'].includes(${CB_DATA})`),
    rule('Generate', `${CB_DATA} === 'gen'`),
    rule('Cancel', `${CB_DATA} === 'cancel'`),
    rule('Company', `['automov','uts'].includes(${CB_DATA})`),
  ] }, looseTypeValidation: true, options: {} } });
link('Get Session (callback)', 'Route Callback');
const SC = "$('Get Session (callback)').first().json";
// Role chosen
ifNode('Is Session Active', [220, -900], `['collecting','review','generating'].includes(${SC}.step)`);
link('Route Callback', 'Is Session Active', 0);
tg('Warning Active Session', [440, -1000], CHAT, '⚠️ Ви вже заповнюєте договір.\nЩоб почати новий — натисніть /start');
link('Is Session Active', 'Warning Active Session', 0);
sessWrite('Start Collecting', [440, -820], 'update', { chat_id: `={{ ${CHAT} }}`, step: 'collecting',
  company: `={{ ${CB_DATA}.startsWith('uts') ? 'uts' : 'automov' }}`, role: `={{ ${CB_DATA} }}`, data: '',
  updated_at: '={{ $now.toISO() }}', raw_input: '', batch_id: '={{ Date.now() }}' });
link('Is Session Active', 'Start Collecting', 1);
ifNode('Is Both Role', [660, -820], `${CB_DATA}.endsWith('_both')`);
link('Start Collecting', 'Is Both Role');
tg('Ask First Data (Both)', [880, -900], CHAT,
  `={{ ${CB_DATA}.startsWith('uts') ? '📋 ЮТС' : '🚛 АвтоМув' }} → обидва договори\n\n1️⃣ Спершу надішліть документи ЗАМОВНИКА (виписка, реквізити, заявка).\n2️⃣ Потім натисніть «${BTN_CARRIER}» і надішліть документи ПЕРЕВІЗНИКА (виписка, реквізити, техпаспорт, посвідчення).\n\nЦіни, маршрут, вантаж, авто й водія — текстом або голосом будь-коли.\nКоли бот підтвердить усі файли — натисніть «✅ Готово».`, sideKb(BTN_CARRIER));
tg('Ask First Data', [880, -760], CHAT,
  `={{ ({automov_z:'🚛 АвтоМув → договір із замовником', automov_p:'🚛 АвтоМув → заявка перевізнику', uts_z:'📋 ЮТС → договір із замовником', uts_p:'📋 ЮТС → заявка перевізнику'})[${CB_DATA}] }}\n\nНадсилайте все, що є, у будь-якому порядку: реквізити (текст, фото, PDF, Word), заявку, техпаспорт, посвідчення водія, голосові.\n\nКоли бот підтвердить усі файли — натисніть «✅ Готово» внизу.`, REPLY_KB);
link('Is Both Role', 'Ask First Data (Both)', 0); link('Is Both Role', 'Ask First Data', 1);
// Generate
ifNode('Is Review Step', [220, -620], `${SC}.step === 'review'`);
link('Route Callback', 'Is Review Step', 1);
sessWrite('Set Generating', [440, -620], 'update', { chat_id: `={{ ${SC}.chat_id }}`, step: 'generating', company: `={{ ${SC}.company }}`, role: `={{ ${SC}.role }}`,
  data: `={{ ${SC}.data }}`, updated_at: '={{ $now.toISO() }}', raw_input: `={{ ${SC}.raw_input || '' }}`, batch_id: `={{ ${SC}.batch_id }}` });
link('Is Review Step', 'Set Generating', 0);
tg('Generating Message', [660, -620], CHAT, '⏳ Генерую документи, зачекайте ~20–40 с…');
link('Set Generating', 'Generating Message');
codeNode('Generate Items', [880, -620], code('05-generate-items.js'));
link('Generating Message', 'Generate Items');
add({ name: 'Contract Generate', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [1100, -620], parameters: {
  workflowId: { __rl: true, value: SUBWF_ID, mode: 'id' },
  workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
  mode: 'each', options: { waitForSubWorkflow: true } } });
link('Generate Items', 'Contract Generate');
const setDone = sessWrite('Set Step Done', [1320, -620], 'update', { chat_id: `={{ ${SC}.chat_id }}`, step: 'done', company: `={{ ${SC}.company }}`, role: `={{ ${SC}.role }}`,
  data: `={{ ${SC}.data }}`, updated_at: '={{ $now.toISO() }}', raw_input: `={{ ${SC}.raw_input || '' }}`, batch_id: `={{ ${SC}.batch_id }}` });
nodes.find(n => n.name === setDone).executeOnce = true;
link('Contract Generate', 'Set Step Done');
tg('Done Message', [1540, -620], CHAT, "={{ ($('Generate Items').first().json.noNumber ? '⚠️⚠️ У документі НЕМАЄ № УГОДИ — замість нього стоїть [ВПИШІТЬ № УГОДИ]. Впишіть номер вручну.\\n\\n' : '') + '✅ Готово! Перевірте та підпишіть документи.\\nНовий договір — /start' }}", REMOVE_KB);
nodes[nodes.length - 1].executeOnce = true;
link('Set Step Done', 'Done Message');
// Cancel (callback + text) -> shared
sessWrite('Cancel Session', [440, -420], 'update', { ...empty, chat_id: `={{ ${CHAT} }}` });
tg('Cancelled Message', [660, -420], CHAT, '❌ Скасовано. Щоб почати новий договір — натисніть /start', REMOVE_KB);
link('Route Callback', 'Cancel Session', 2); link('Cancel Session', 'Cancelled Message');
// Company chosen
ifNode('Which Company', [220, -260], `${CB_DATA} === 'automov'`);
link('Route Callback', 'Which Company', 3);
tg('Ask Role - AutoMov', [440, -320], CHAT, '🚛 АвтоМув обрано!\nОберіть тип договору:', roleKb('automov'));
tg('Ask Role - UTS', [440, -180], CHAT, '📋 ЮТС обрано!\nОберіть тип договору:', roleKb('uts'));
link('Which Company', 'Ask Role - AutoMov', 0); link('Which Company', 'Ask Role - UTS', 1);
sessWrite('Save Company', [660, -260], 'update', { chat_id: `={{ ${CHAT} }}`, step: 'choose_role', company: `={{ ${CB_DATA} }}`, role: '', data: '',
  updated_at: '={{ $now.toISO() }}', raw_input: '', batch_id: '' });
link('Ask Role - AutoMov', 'Save Company'); link('Ask Role - UTS', 'Save Company');

// --- message branch ---
sessRead('Get Session', [-220, 300], `${T}.message?.chat?.id`);
link('Is Callback', 'Get Session', 1);
const S = "$('Get Session').first().json";
const TXT = `${T}.message?.text`;
add({ name: 'Route by Step', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [0, 300], parameters: {
  rules: { values: [
    rule('New', `!${S}.step`),
    rule('Cancel', `${TXT} === '❌ Скасувати'`),
    rule('Side', `${S}.step === 'collecting' && ['${BTN_CARRIER}', '${BTN_CLIENT}'].includes(${TXT})`),
    rule('Ready', `${S}.step === 'collecting' && ${TXT} === '✅ Готово'`),
    rule('Input', `${S}.step === 'collecting' || (${S}.step === 'review' && ${TXT} !== '✅ Готово')`),
    rule('Done', `${S}.step === 'done'`),
  ] }, looseTypeValidation: true, options: { fallbackOutput: 'extra' } } });
link('Get Session', 'Route by Step');
// New user / empty step
tg('Welcome Message', [220, 0], CHAT, '👋 Вітаю! Це Contract Bot v2. Оберіть компанію для договору:', WELCOME_KB);
sessWrite('Create Session', [440, 0], 'appendOrUpdate', { ...empty, chat_id: `={{ ${T}.message.chat.id }}`, step: 'choose_company' });
link('Route by Step', 'Welcome Message', 0); link('Welcome Message', 'Create Session');
link('Route by Step', 'Cancel Session', 1);
// Side switch («Обидва»)
sessWrite('Set Side', [220, -60], 'update', { chat_id: `={{ ${S}.chat_id }}`, step: `={{ ${S}.step }}`, company: `={{ ${S}.company }}`, role: `={{ ${S}.role }}`,
  data: `={{ ${S}.data }}`, updated_at: '={{ $now.toISO() }}', raw_input: `={{ ${TXT} === '${BTN_CARRIER}' ? 'carrier' : '' }}`, batch_id: `={{ ${S}.batch_id }}` });
link('Route by Step', 'Set Side', 2);
ifNode('Is Carrier Side', [440, -60], `${TXT} === '${BTN_CARRIER}'`);
link('Set Side', 'Is Carrier Side');
tg('Carrier Side Message', [660, -120], CHAT, `🚚 Тепер надсилайте документи ПЕРЕВІЗНИКА: виписку, реквізити, техпаспорт, посвідчення водія.\nПомилились — «${BTN_CLIENT}». Усе надіслано — «✅ Готово».`, sideKb(BTN_CLIENT));
tg('Client Side Message', [660, 0], CHAT, `👤 Знову приймаю документи ЗАМОВНИКА.\nДалі — «${BTN_CARRIER}». Усе надіслано — «✅ Готово».`, sideKb(BTN_CARRIER));
link('Is Carrier Side', 'Carrier Side Message', 0); link('Is Carrier Side', 'Client Side Message', 1);
// Done -> restart (як у v1)
link('Route by Step', 'Reset Session', 5);
// Fallback hint
tg('Hint Message', [220, 900], CHAT, `={{ ({review:'Натисніть «🚀 Генерувати» під оглядом або надішліть, що змінити.', generating:'⏳ Документи генеруються, зачекайте…', choose_company:'Оберіть компанію кнопкою вище або натисніть /start', choose_role:'Оберіть тип договору кнопкою вище або натисніть /start'})[${S}.step] || 'Натисніть /start' }}`);
link('Route by Step', 'Hint Message', 6);

// Ready -> Extract
add({ name: 'Get Inputs', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [220, 200], credentials: GS, alwaysOutputData: true,
  parameters: { documentId: doc, sheetName: INPUTS, filtersUI: { values: [{ lookupColumn: 'chat_id', lookupValue: `={{ ${S}.chat_id }}` }] }, options: {} } });
link('Route by Step', 'Get Inputs', 3);
codeNode('Build AI Request', [3400, 200], code('02-build-request.js'));
link('Get Inputs', 'Build AI Request');
ifNode('Is Bundle Empty', [3620, 200], '$json.empty');
link('Build AI Request', 'Is Bundle Empty');
tg('Nothing Received', [3840, 100], CHAT, 'Ще нічого не отримано.\nЯкщо файли ще обробляються — дочекайтесь «📥 Прийнято» на кожен і натисніть «✅ Готово» ще раз.');
link('Is Bundle Empty', 'Nothing Received', 0);
tg('Processing Message', [3840, 300], CHAT, "={{ $json.mode === 'patch' ? '⏳ Вношу зміни…' : '⏳ Беру документів: ' + $json.count + '. Розпізнаю, ~20–60 с…' + ($json.cut ? '\\n⚠️ Забагато тексту — частину документів обрізано.' : '') }}");
link('Is Bundle Empty', 'Processing Message', 1);
add({ name: 'OpenAI Extract', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [4060, 300], credentials: OAH, parameters: {
  method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
  sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Build AI Request').first().json.body) }}", options: { timeout: 120000 } } });
link('Processing Message', 'OpenAI Extract');
codeNode('Post-process', [4280, 300], code('03-post-process.js'));
link('OpenAI Extract', 'Post-process');
sessWrite('Save Session', [4500, 300], 'update', { chat_id: `={{ ${S}.chat_id }}`, step: `={{ $json.error ? ${S}.step : 'review' }}`, company: `={{ ${S}.company }}`,
  role: `={{ ${S}.role }}`, data: `={{ $json.error ? ${S}.data : $json.dataJson }}`, updated_at: '={{ $now.toISO() }}', raw_input: `={{ ${S}.raw_input || '' }}`, batch_id: `={{ ${S}.batch_id }}` });
link('Post-process', 'Save Session');
const rs = code('04-review-screen.js');
if (!rs.includes('const r = $input.first().json;')) throw new Error('review screen input line changed');
codeNode('Review Screen', [4720, 300], rs.replace('const r = $input.first().json;', "const r = $('Post-process').first().json;"));
link('Save Session', 'Review Screen');
tg('Send Review', [4940, 300], CHAT, "={{ String($json.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }}", inlineKb([[['🚀 Генерувати', 'gen'], ['❌ Скасувати', 'cancel']]]));
link('Review Screen', 'Send Review');

// Input -> media branch (v1) -> Normalize Text
const MT = 'What is Message Type';
copyV1(MT, [220, 600]);
link('Route by Step', MT, 4);
const media = [
  ['Is Voice', [440, 700]], ['Download Voice', [1340, 400]], ['Whisper', [1560, 400]],
  ['Is Photo', [660, 760]], ['Download Photo', [1120, 560]], ['OpenAI Vision', [1340, 600]],
  ['Is Document', [880, 900]], ['Route by File Type', [1100, 900]], ['Download Document', [1120, 700]],
  ['Download Document (PDF)', [1340, 820]], ['Convert PDF to Base64', [1560, 820]], ['Analyze PDF (OpenAI)', [1780, 820]],
  ['Download Document (Word)', [1340, 1040]], ['Upload file', [1560, 1040]], ['Convert to Google Doc (Word)', [1780, 1040]],
  ['Download file', [2000, 1040]], ['Delete Upload (Word)', [2220, 1140]], ['Delete Converted Doc (Word)', [2440, 1140]],
  ['Send Unsupported File Warning', [1340, 1240]], ['Normalize Text', [2440, 600]],
];
for (const [n, p] of media) copyV1(n, p);
// Analyze PDF: universal prompt (any document, not only requisites)
{
  const n = nodes.find(x => x.name === 'Analyze PDF (OpenAI)');
  const before = n.parameters.jsonBody;
  n.parameters.jsonBody = before.replace(/"text": "Це скан або PDF[^"]*"/,
    '"text": "Розпізнай і випиши ВЕСЬ текст цього документа як є, зберігаючи порядок і пари «назва поля: значення». Це може бути виписка, картка підприємства, рахунок, заявка на перевезення, договір, техпаспорт, посвідчення водія тощо. Цифри (ЄДРПОУ, IBAN, номери, суми, дати) переписуй символ у символ, без округлень і виправлень. Виведи лише текст документа, без власних коментарів."');
  if (before === n.parameters.jsonBody) throw new Error('PDF prompt not replaced');
}
for (const [from, outs] of Object.entries(v1.connections)) {
  if (!media.some(m => m[0] === from) && from !== MT) continue;
  (outs.main || []).forEach((arr, i) => (arr || []).forEach(t => {
    if (t.node === 'Is Route Step') return; // v1 parsers не потрібні
    link(from, t.node, i);
  }));
}
// PDF: спершу текстовий шар (усі сторінки, точно, безкоштовно); ШІ — лише для сканів
{
  const c = nodes.find(x => x.name === 'Convert PDF to Base64');
  c.parameters.jsCode = c.parameters.jsCode.replace('return [{json: {pdfBase64: base64String, fileName}}];',
    'return [{json: {pdfBase64: base64String, fileName}, binary: $input.first().binary}];');
  if (!c.parameters.jsCode.includes('binary: $input')) throw new Error('b64 not patched');
  const a = nodes.find(x => x.name === 'Analyze PDF (OpenAI)');
  a.parameters.jsonBody = a.parameters.jsonBody
    .replace('{{ $json.fileName }}', "{{ $('Convert PDF to Base64').first().json.fileName }}")
    .replace('{{ $json.pdfBase64 }}', "{{ $('Convert PDF to Base64').first().json.pdfBase64 }}")
    .replace('Розпізнай і випиши ВЕСЬ текст', 'Документ може мати кілька сторінок — розпізнай УСІ сторінки до кінця. Випиши ВЕСЬ текст');
  if (!a.parameters.jsonBody.includes("$('Convert PDF to Base64')") || !a.parameters.jsonBody.includes('УСІ сторінки')) throw new Error('analyze not patched');
  a.position = [2220, 900];
  const nt = nodes.find(x => x.name === 'Normalize Text');
  const o = "let pdfData = $('Analyze PDF (OpenAI)').first().json;";
  if (!nt.parameters.jsCode.includes(o)) throw new Error('normalize pdf line');
  nt.parameters.jsCode = nt.parameters.jsCode
    .replace(o, "let pdfData = $('Analyze PDF (OpenAI)').isExecuted ? $('Analyze PDF (OpenAI)').first().json : null;")
    .replace('return [{json: {userText}}];',
      "if ((tgMessage?.document?.mime_type || '').includes('pdf') && !$('Analyze PDF (OpenAI)').isExecuted) {\n  userText = String($('Extract PDF Text').first().json.text || '');\n}\nreturn [{json: {userText}}];");
  if (!nt.parameters.jsCode.includes("$('Extract PDF Text')")) throw new Error('normalize not patched');
  add({ name: 'Extract PDF Text', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [1780, 760], onError: 'continueRegularOutput',
    parameters: { operation: 'pdf', binaryPropertyName: 'data', options: {} } });
  ifNode('Has PDF Text', [2000, 760], "String($json.text || '').replace(/\\s+/g, '').length > 200");
}

// After Normalize Text
conns['Convert PDF to Base64'].main = [[{ node: 'Extract PDF Text', type: 'main', index: 0 }]];
link('Extract PDF Text', 'Has PDF Text');
link('Has PDF Text', 'Normalize Text', 0);
link('Has PDF Text', 'Analyze PDF (OpenAI)', 1);
ifNode('Is Review (patch)', [2660, 600], `${S}.step === 'review'`);
link('Normalize Text', 'Is Review (patch)');
link('Is Review (patch)', 'Build AI Request', 0);
ifNode('Has Text', [2880, 700], "String($json.userText || '').trim().length > 0");
link('Is Review (patch)', 'Has Text', 1);
const M = `${T}.message`;
const SIDE_SUFFIX = `(String(${S}.role || '').endsWith('_both') ? (${S}.raw_input === 'carrier' ? ':carrier' : ':client') : '')`;
const SIDE_LABEL = `(String(${S}.role || '').endsWith('_both') ? (${S}.raw_input === 'carrier' ? ' → 🚚 перевізник' : ' → 👤 замовник') : '')`;
const KIND = `${M}.voice ? 'voice' : ${M}.photo ? 'photo' : (${M}.document?.mime_type || '').includes('pdf') ? 'pdf' : (${M}.document?.mime_type || '').includes('word') ? 'word' : ${M}.document ? 'photo' : 'text'`;
add({ name: 'Append to Inputs', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [3100, 640], credentials: GS, parameters: {
  operation: 'append', documentId: doc, sheetName: INPUTS,
  columns: { mappingMode: 'defineBelow', value: { chat_id: `={{ ${S}.chat_id }}`, batch_id: `={{ ${S}.batch_id }}`, kind: `={{ (${KIND}) + ${SIDE_SUFFIX} }}`,
    name: `={{ ${M}.document?.file_name || '' }}`, text: '={{ $json.userText }}', created_at: '={{ $now.toISO() }}' },
    matchingColumns: [], schema: schema(INPUT_COLS), attemptToConvertTypes: false, convertFieldsToString: false },
  // useAppend: справжній append Google API — паралельні запуски (альбом файлів) не перезаписують один одного
  options: { cellFormat: 'RAW', useAppend: true } } });
link('Has Text', 'Append to Inputs', 0);
tg('Accepted Message', [3320, 640], CHAT,
  `={{ '📥 Прийнято: ' + ({voice:'голосове', photo:'фото', pdf:'PDF', word:'Word', text:'текст'})[${KIND}] + (${M}.document?.file_name ? ' «' + ${M}.document.file_name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '»' : '') + ${SIDE_LABEL} + '.\\nНадсилайте ще або натисніть «✅ Готово».' }}`);
link('Append to Inputs', 'Accepted Message');
tg('Read Failed', [3100, 820], CHAT, '⚠️ Не вдалося прочитати цей файл. Спробуйте інше фото/файл або надішліть текстом.');
link('Has Text', 'Read Failed', 1);

// Мережеві збої (альбом із 6+ файлів качається паралельно): «connection closed unexpectedly» на Download Document (Word)
// мовчки губив файл. Повтор 3 рази з паузою.
for (const n of nodes) {
  if (/^Download |^Whisper$|^OpenAI Vision$|^Analyze PDF|^Upload file$|^Convert to Google Doc \(Word\)$|^Append to Inputs$|^OpenAI Extract$|^Get Inputs$/.test(n.name)) {
    n.retryOnFail = true; n.maxTries = 3; n.waitBetweenTries = 2000;
  }
}
if (nodes.filter(n => n.retryOnFail).length < 12) throw new Error('retry not applied: ' + nodes.filter(n => n.retryOnFail).map(n => n.name));
// Telegram nodes in media branch reference chat via v1 expressions — fine (Telegram Trigger).
const main = { name: 'Contract Bot v2', nodes, connections: conns, settings: { executionOrder: 'v1', timezone: 'Europe/Kyiv' } };

// sanity: every connection target exists, no Telegram node left on prod credential
const names = new Set(nodes.map(n => n.name));
for (const [f, o] of Object.entries(conns)) { if (!names.has(f)) throw new Error('src ' + f); o.main.flat().forEach(t => { if (!names.has(t.node)) throw new Error('dst ' + t.node); }); }
if (names.size !== nodes.length) throw new Error('dup names');
for (const n of nodes) if (n.credentials?.telegramApi && n.credentials.telegramApi.id !== TG.telegramApi.id) throw new Error('wrong tg cred ' + n.name);
const s = JSON.stringify(main);
if (s.includes('gid=0') || s.includes('Is Route Step') || s.includes('efprhPPBoxoqxNFd')) throw new Error('v1 leftovers / mixed creds');
fs.writeFileSync(path.join(SP, 'v2_main.json'), JSON.stringify({ nodes, connections: conns }, null, 1));

// ================= SUB-WORKFLOW =================
const sn = [], sc = {};
const sadd = n => { n.id = uuid(); sn.push(n); };
const slink = (a, b) => { sc[a] = { main: [[{ node: b, type: 'main', index: 0 }]] }; };
const IN = "$('When Executed by Another Workflow').item.json";
sadd({ name: 'When Executed by Another Workflow', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0], parameters: { inputSource: 'passthrough' } });
sadd({ name: 'Copy file', type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: [220, 0], credentials: GD, parameters: {
  operation: 'copy', fileId: { __rl: true, value: '={{ $json.templateId }}', mode: 'id' }, name: '={{ $json.fileName }}', options: {} } });
const conv = v1n('Convert to Google Doc');
sadd({ name: 'Convert to Google Doc', type: conv.type, typeVersion: conv.typeVersion, position: [440, 0], credentials: GD, parameters: { ...conv.parameters,
  jsonBody: `={{ JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: ${IN}.fileName }) }}` } });
const rep = v1n('Replace Placeholders');
sadd({ name: 'Replace Placeholders', type: rep.type, typeVersion: rep.typeVersion, position: [660, 0], credentials: GDOC, parameters: { ...rep.parameters,
  jsonBody: `={{ JSON.stringify({ requests: ${IN}.requests }) }}` } });
const exp = v1n('Export as DOCX');
sadd({ name: 'Export as DOCX', type: exp.type, typeVersion: exp.typeVersion, position: [880, 0], credentials: GD, parameters: exp.parameters });
sadd({ name: 'Send a document', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1100, 0], webhookId: uuid(), credentials: TG, parameters: {
  operation: 'sendDocument', chatId: `={{ ${IN}.chat_id }}`, binaryData: true,
  additionalFields: { caption: `={{ '📄 ' + ${IN}.fileName }}`, fileName: `={{ ${IN}.fileName + '.docx' }}` } } });
const d1 = v1n('Delete DOCX Copy'), d2 = v1n('Delete Google Doc');
sadd({ name: 'Delete DOCX Copy', type: d1.type, typeVersion: d1.typeVersion, position: [1320, 0], credentials: GD, parameters: d1.parameters });
sadd({ name: 'Delete Google Doc', type: d2.type, typeVersion: d2.typeVersion, position: [1540, 0], credentials: GD, parameters: d2.parameters });
['When Executed by Another Workflow', 'Copy file', 'Convert to Google Doc', 'Replace Placeholders', 'Export as DOCX', 'Send a document', 'Delete DOCX Copy']
  .forEach((n, i, a) => slink(n, i < a.length - 1 ? a[i + 1] : 'Delete Google Doc'));
fs.writeFileSync(path.join(SP, 'v2_generate.json'), JSON.stringify({ nodes: sn, connections: sc }, null, 1));
console.log('main nodes', nodes.length, 'sub nodes', sn.length, 'SUBWF', SUBWF_ID);
