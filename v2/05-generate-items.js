// n8n Code node «Generate Items» — Run Once for All Items. Стоїть у головному workflow після натискання «🚀 Генерувати».
// Вихід: по одному item на кожен документ ролі (для «Обидва» — два). Далі вузол Execute Workflow «Contract Generate»
// (Mode: Run once for each item) — і кожен документ збирається окремо, без плутанини pairing.

const cfg = $('Template Config').first().json;
const session = $('Get Session (callback)').first().json;
let data = {};
try { data = JSON.parse(session.data || '{}'); } catch (e) { data = {}; }

const ids = cfg.ROLE_DOCS[session.role] || [];
// Номер не вигадуємо: якщо його не назвали — у договорі помітна позначка, менеджер впише вручну.
const NO_NUMBER = '[ВПИШІТЬ № УГОДИ]';
const noNumber = !data.CONTRACT_NUMBER;
if (noNumber) data.CONTRACT_NUMBER = NO_NUMBER;

// Ціни в документі — повністю: «15 000 грн, без ПДВ, безготівковий розрахунок».
// У сесії лишаються числа (для перевірки маржі); ПДВ замовнику — за нашою компанією, перевізнику — за його податковим статусом.
const co = cfg.OUR[(session.role || '').startsWith('uts') ? 'uts' : 'automov'];
const money = v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// «без реєстрації ПДВ», «не є платником ПДВ», «неплатник» → без ПДВ
const carrierVat = /ПДВ/i.test(data.CARRIER_TAX || '') && !/без\s+(реєстрації\s+)?ПДВ|неплатник|не\s+є\s+платник/i.test(data.CARRIER_TAX || '');
const priceText = (v, vat) => (/^\d+(\.\d+)?$/.test(String(v || '')) ? `${money(v)} грн, ${vat ? 'з ПДВ' : 'без ПДВ'}, безготівковий розрахунок` : String(v || ''));
data.SERVICE_PRICE = priceText(data.SERVICE_PRICE, co.vat);
data.TRANSPORT_PRICE = priceText(data.TRANSPORT_PRICE, carrierVat);

return ids.map(id => {
  const t = cfg.TEMPLATES[id];
  const requests = Object.entries(data).map(([key, value]) => ({
    replaceAllText: { containsText: { text: `{{${key}}}`, matchCase: true }, replaceText: String(value ?? '') },
  }));
  const route = (data.ROUTE || 'рейс').replace(/[^\p{L}\p{N} .-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { json: {
    chat_id: String(session.chat_id),
    templateId: t.templateId,
    fileName: `${t.side === 'z' ? 'Договір' : 'Заявка'} ${noNumber ? 'БЕЗ НОМЕРА' : data.CONTRACT_NUMBER} ${route}`.replace(/\s+/g, ' ').trim(),
    requests,
    noNumber,
  } };
});
