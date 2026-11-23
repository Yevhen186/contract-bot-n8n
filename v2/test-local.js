// Локальна перевірка Code-вузлів v2 без n8n: node test-local.js
// Імітує $('Node') і $input, проганяє ланцюжок Config → Build Request → (відповідь ШІ) → Post-process → Review → Generate.
// Дані вигадані.
const fs = require('fs'), path = require('path'), assert = require('assert');
const run = (file, nodes, input) => {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const $ = name => { if (!(name in nodes)) throw new Error(file + ': немає вузла ' + name); const v = nodes[name]; return { first: () => ({ json: v }), all: () => [{ json: v }] }; };
  const $input = { first: () => ({ json: input[0] }), all: () => input.map(json => ({ json })) };
  return new Function('$', '$input', `return (async () => { ${code} })();`)($, $input);
};

(async () => {
  const nodes = {};
  nodes['Template Config'] = (await run('01-template-config.js', nodes, []))[0].json;
  nodes['Get Session'] = { chat_id: '111', role: 'automov_both', step: 'collecting', batch_id: 'b1', data: '' };

  const inputs = [
    { chat_id: '111', batch_id: 'b1', kind: 'pdf', name: 'Виписка.pdf', text: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "БУДТРЕЙД-ГРУП" код 43718621 "лапки" і\nпереноси' },
    { chat_id: '111', batch_id: 'b0', kind: 'text', name: '', text: 'старий рейс — не має потрапити' },
    { chat_id: '111', batch_id: 'b1', kind: 'voice', name: '', text: 'угода 62811450, ціна клієнту 7000, перевізнику 5500' },
    { chat_id: '111', batch_id: 'b1', kind: 'photo', name: '', text: '' },
  ];
  const req = (await run('02-build-request.js', nodes, inputs))[0].json;
  assert.strictEqual(req.count, 2, 'дві непорожні вхідні цієї пачки');
  assert(!req.body.messages[1].content.includes('старий рейс'));
  assert(req.body.messages[0].content.includes('45618360'), 'наші реквізити в промпті');
  const sch = req.body.response_format.json_schema.schema;
  assert.deepStrictEqual(sch.required.sort(), Object.keys(sch.properties).sort(), 'strict: усі поля required');
  JSON.parse(JSON.stringify(req.body));
  assert(!req.body.messages[0].content.includes('РОЗДІЛЕНІ'), 'без поміток — без правила розділів');

  // «Обидва» з кнопкою: файли перевізника прийшли раніше за замовника — все одно групуються правильно
  const sreq = (await run('02-build-request.js', nodes, [
    { batch_id: 'b1', kind: 'pdf:carrier', name: 'СПК Ковальчук.pdf', text: 'КОВАЛЬЧУК ОКСАНА ПЕТРІВНА 3104528715' },
    { batch_id: 'b1', kind: 'pdf:client', name: 'Виписка.pdf', text: 'АГРОСВІТ' },
    { batch_id: 'b1', kind: 'text:carrier', name: '', text: 'ціна 15000' },
  ]))[0].json;
  const su = sreq.body.messages[1].content;
  assert(su.indexOf('ДОКУМЕНТИ ЗАМОВНИКА') < su.indexOf('АГРОСВІТ') && su.indexOf('АГРОСВІТ') < su.indexOf('ДОКУМЕНТИ ПЕРЕВІЗНИКА') && su.indexOf('ДОКУМЕНТИ ПЕРЕВІЗНИКА') < su.indexOf('КОВАЛЬЧУК'), 'групи в правильному порядку');
  assert(!su.includes('pdf:carrier') && sreq.count === 3 && sreq.body.messages[0].content.includes('РОЗДІЛЕНІ'));

  // відповідь моделі (вигадана): IBAN без UA, ФОП зі «Статутом», наші реквізити в перевізнику не заважають — інша сторона
  const F = nodes['Template Config'].FIELDS, ans = {};
  Object.keys(F).forEach(k => { ans[k] = ''; });
  Object.assign(ans, {
    CONTRACT_NUMBER: '62811450',
    CLIENT_COMPANY: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «БУДТРЕЙД-ГРУП»', CLIENT_EDRPOU: '43718621', CLIENT_DIRECTOR: 'Мельник Олег Петрович',
    CLIENT_BASIS: 'Статуту', CLIENT_ADDRESS: 'м. Буча, вул. Яблунська, 112', CLIENT_IBAN: '853003350000000260011223344', CLIENT_BANK: 'АТ «Райффайзен Банк»', CLIENT_PHONE: '+380673291045',
    CARRIER_COMPANY: 'ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ ГОНЧАРУК ІГОР ВАСИЛЬОВИЧ', CARRIER_EDRPOU: '3124508717', CARRIER_BASIS: 'Статуту',
    CARRIER_ADDRESS: 'м. Житомир', CARRIER_IBAN: 'UA22 3052 9900 0002 6007 0155 98481', CARRIER_BANK: 'ПриватБанк', CARRIER_PHONE: '+380981124507', CARRIER_TAX: 'Платник єдиного податку 3 групи (5%)',
    ROUTE: 'м. Коростишів - с. Ворзель', CARGO_INFO: 'Гранітні вироби, 3 т', LOADING_ADDRESS: 'м. Коростишів', LOADING_DATE: '26.10.2026',
    UNLOADING_ADDRESS: 'с. Ворзель', DELIVERY_DATE: '27.10.2026', VEHICLE_INFO: 'DAF LF 45', DRIVER_INFO: 'Савчук Андрій Олегович',
    SERVICE_PRICE: '7 000', TRANSPORT_PRICE: '5500', CLIENT_TERMS: 'до дати доставки',
  });
  ans.conflicts = [{ field: 'CARRIER_ADDRESS', options: ['10025, м. Житомир', '10009, м. Житомир'] }];
  ans.unassigned = []; ans.notes = '';
  const post = (await run('03-post-process.js', nodes, [{ choices: [{ message: { content: JSON.stringify(ans) } }] }]))[0].json;
  const d = post.data;
  assert.strictEqual(d.CARRIER_BASIS, 'Виписки з ЄДР', 'ФОП: підставу виправлено');
  assert.strictEqual(d.CARRIER_DIRECTOR, 'Гончарук Ігор Васильович');
  assert.strictEqual(d.CARRIER_IPN, '3124508717');
  assert.strictEqual(d.SERVICE_PRICE, '7000');
  assert.strictEqual(d.CLIENT_COMPANY_SHORT, 'ТОВ «БУДТРЕЙД-ГРУП»');
  assert(post.warnings.some(w => w.includes('IBAN перевізника')), 'битий IBAN перевізника пійманий');
  assert(!post.warnings.some(w => w.includes('IBAN замовника')), 'IBAN замовника правильний');
  assert.deepStrictEqual(post.missing, []);  // TERMS немає в шаблонах — не вимагаємо

  // наші реквізити в стороні — очищаються
  const bad = { ...ans, CARRIER_EDRPOU: '45618360' };
  const post2 = (await run('03-post-process.js', nodes, [{ choices: [{ message: { content: JSON.stringify(bad) } }] }]))[0].json;
  assert.strictEqual(post2.data.CARRIER_COMPANY, '');

  // випадок із практики (дані вигадані): ШІ загубив одну «1» в IBAN → виправляємо за текстом документа
  nodes['Build AI Request'] = { body: { messages: [{}, { content: 'р/р UA 93 305299 0000026007015598123 \nНазва банку: АТ КБ «ПриватБанк»' }] } };
  const nes = { ...ans, CARRIER_COMPANY: 'ФІЗИЧНА ОСОБА - ПІДПРИЄМЕЦЬ КОВАЛЬЧУК ОКСАНА ПЕТРІВНА', CARRIER_EDRPOU: '3104528715', CARRIER_DIRECTOR: '', CARRIER_IBAN: '93305299000002600701559823' };
  const pn = (await run('03-post-process.js', nodes, [{ choices: [{ message: { content: JSON.stringify(nes) } }] }]))[0].json;
  assert.strictEqual(pn.data.CARRIER_IBAN, '933052990000026007015598123', 'IBAN виправлено з тексту');
  assert(!pn.warnings.some(w => w.includes('IBAN перевізника')), 'після виправлення попередження немає');
  assert.strictEqual(pn.data.CARRIER_COMPANY_SHORT, 'ФОП КОВАЛЬЧУК ОКСАНА ПЕТРІВНА');
  assert.strictEqual(pn.data.CARRIER_DIRECTOR, 'Ковальчук Оксана Петрівна');
  delete nodes['Build AI Request'];

  const rev = (await run('04-review-screen.js', nodes, [post]))[0].json;
  assert(rev.text.length < 4096 && rev.text.includes('Маржа: 1'));

  // patch-режим: поточні дані йдуть у промпт
  nodes['Get Session'] = { ...nodes['Get Session'], step: 'review', data: post.dataJson };
  nodes['Normalize Text'] = { userText: 'оплата перевізнику 100% після оригіналів' };
  const preq = (await run('02-build-request.js', nodes, []))[0].json;
  assert(preq.mode === 'patch' && preq.body.messages[1].content.includes('62811450'));

  nodes['Get Session (callback)'] = nodes['Get Session'];
  const gen = await run('05-generate-items.js', nodes, []);
  assert.strictEqual(gen.length, 2, '«Обидва» → 2 документи');
  assert(gen[0].json.fileName.startsWith('Договір 62811450'));
  const price = (g, k) => g.json.requests.find(r => r.replaceAllText.containsText.text === `{{${k}}}`).replaceAllText.replaceText;
  assert.strictEqual(price(gen[1], 'TRANSPORT_PRICE'), '5 500 грн, без ПДВ, безготівковий розрахунок');
  // ПДВ перевізника за податковим статусом
  for (const [tax, want] of [['Платник єдиного податку 3 групи (3%), платник ПДВ', 'з ПДВ'], ['3 група, без реєстрації ПДВ', 'без ПДВ'], ['не є платником ПДВ', 'без ПДВ']]) {
    const dd = JSON.parse(post.dataJson); dd.CARRIER_TAX = tax;
    nodes['Get Session (callback)'] = { ...nodes['Get Session'], data: JSON.stringify(dd) };
    const g = await run('05-generate-items.js', nodes, []);
    assert(price(g[1], 'TRANSPORT_PRICE').includes(', ' + want + ','), tax + ' → ' + want);
  }

  console.log(rev.text);
  console.log('\nOK: усі перевірки пройшли');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
