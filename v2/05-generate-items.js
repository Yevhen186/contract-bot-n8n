// n8n Code node «Generate Items» — Run Once for All Items. Стоїть у головному workflow після натискання «🚀 Генерувати».
// Вихід: по одному item на кожен документ ролі (для «Обидва» — два). Далі вузол Execute Workflow «Contract Generate»
// (Mode: Run once for each item) — і кожен документ збирається окремо, без плутанини pairing.

const cfg = $('Template Config').first().json;
const session = $('Get Session (callback)').first().json;
let data = {};
try { data = JSON.parse(session.data || '{}'); } catch (e) { data = {}; }

const ids = cfg.ROLE_DOCS[session.role] || [];
return ids.map(id => {
  const t = cfg.TEMPLATES[id];
  const requests = Object.entries(data).map(([key, value]) => ({
    replaceAllText: { containsText: { text: `{{${key}}}`, matchCase: true }, replaceText: String(value ?? '') },
  }));
  const route = (data.ROUTE || 'рейс').replace(/[^\p{L}\p{N} .-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { json: {
    chat_id: String(session.chat_id),
    templateId: t.templateId,
    fileName: `${t.side === 'z' ? 'Договір' : 'Заявка'} ${data.CONTRACT_NUMBER || ''} ${route}`.replace(/\s+/g, ' ').trim(),
    requests,
  } };
});
