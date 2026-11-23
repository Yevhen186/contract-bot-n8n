# Contract Bot v2 — вузли, готові до вставки

Код Code-вузлів перевірено локально (`node test-local.js`) і працює в n8n (листопад 2026). Готові workflow — у `../workflows/`, збираються скриптом `build/build_v2.js`.
Схема — у `docs/v2-architecture.md`. Збираємо **копію** workflow «Contract Bot v2», v1 не чіпаємо.

## Що підготувати в Google Sheets
1. Лист **Sessions**: додати колонку **H `batch_id`**.
2. Новий лист **Inputs**, колонки: `chat_id | batch_id | kind | name | text | created_at`.

## Вузли (у порядку потоку)

| # | Вузол | Тип | Що всередині |
|---|---|---|---|
| 1 | Template Config | Code | `01-template-config.js` — ставиться одразу після Telegram Trigger |
| 2 | Get Session | Google Sheets → Get Row(s) | як у v1 (фільтр chat_id) |
| 3 | Після вибору ролі | Google Sheets → Update | step=`collecting`, batch_id=`{{ Date.now() }}`, data=`""` |
| 4 | step = collecting + файл/голос/текст | гілка медіа v1 → Normalize Text | без змін |
| 5 | Append to Inputs | Google Sheets → Append | chat_id, batch_id з сесії, kind (`voice/photo/pdf/word/text`), name, text=`{{ $json.userText }}`, created_at=`{{ $now.toISO() }}` |
| 6 | Прийнято | Telegram | «📥 Прийнято. Надсилайте ще або натисніть ✅ Готово» |
| 7 | Текст = «✅ Готово» | IF | → Get Inputs |
| 8 | Get Inputs | Google Sheets → Get Row(s) | фільтр chat_id; **Always Output Data** увімкнути |
| 9 | Build AI Request | Code | `02-build-request.js` |
| 10 | OpenAI Extract | HTTP Request | POST `https://api.openai.com/v1/chat/completions`, Body: JSON, поле JSON = `{{ $json.body }}`, та сама credential, що в v1. Timeout 120000 |
| 11 | Post-process | Code | `03-post-process.js` |
| 12 | Save Session | Google Sheets → Update | **усі колонки** (урок 3): step=`review`, data=`{{ $json.dataJson }}`, решта — з Get Session |
| 13 | Review Screen | Code | `04-review-screen.js` |
| 14 | Send Review | Telegram | текст `{{ $json.text }}`, **без parse mode**, Inline Keyboard: `🚀 Генерувати` (callback `gen`), `❌ Скасувати` (callback `cancel`) |
| 15 | step = review + будь-яке повідомлення | → Normalize Text → **9** | той самий Build AI Request сам перемикається в режим виправлення (Patch) |
| 16 | callback `gen` | Get Session (callback) → IF step=review → Update step=`generating` → Generate Items | `05-generate-items.js` |
| 17 | Contract Generate | Execute Workflow, Run once for each item | окремий workflow: Copy file (fileId `{{ $json.templateId }}`, name `{{ $json.fileName }}`) → Convert → Replace (`{{ JSON.stringify({requests: $json.requests}) }}`) → Export DOCX → Send document (chat_id `{{ $json.chat_id }}`) → Delete. Ланцюжок v1 без змін |
| 18 | Після генерації | Google Sheets → Update | step=`done` |

Повторне натискання «Генерувати» на кроці `generating` ігнорується (IF у п. 16).

## Що питати користувача голосом
- «угода 62811450» → № договору.
- «адреса правильна 10025» → вибір із конфлікту.
- «Альфа — це перевізник» → сторона компанії з ❓.
- «оплата перевізнику 100% після оригіналів» → будь-яке поле.

## Свідомо не зроблено
- Перевірка «ціна перевізнику проти ринку» — є лише в прототипі сайту; потребує відстані (OpenRouteService з калькулятора).
- Розрив сторінки перед реквізитами/підписами — лишається менеджеру.
