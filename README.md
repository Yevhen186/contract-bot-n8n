# 📄 Contract Bot — AI contract generation for a logistics company

🇬🇧 English | [🇺🇦 Українська](README.uk.md)

> Built for and used in a real Ukrainian freight-forwarding company (2025–2026).
> n8n · OpenAI · Google Drive/Docs/Sheets · Telegram

A logistics manager drops **everything they have about a trip** into Telegram — company registry extracts (PDF), bank details (Word), photos of a vehicle registration and driver's licence, a voice note with prices — and gets back **ready-to-sign `.docx` contracts** for the client and for the carrier.

Manual drafting took 15–20 minutes per trip and produced typos in IBANs and tax codes. With the bot it is ~2 minutes, and every code is checksum-validated before a document is created.

---

## ✨ What it does (v2)

- **Any input, any order, any amount.** Text, voice (Whisper), photos (GPT-4o Vision), PDF, Word. Every message is saved to a batch; the AI reads the whole batch at once when the manager presses **✅ Готово**.
- **One trip → both contracts.** «Обидва» mode: the manager sends the client's documents, presses **🚚 Далі: перевізник**, sends the carrier's documents. Each input is tagged with its side, so the AI never mixes up who is who.
- **Review before generating.** The bot shows what it found, what is missing and what conflicts between documents. The manager fixes anything by voice or text ("адреса правильна 10025", "ціна перевізнику 15 000") — only the requested field changes.
- **Deterministic validation after AI** (no AI in this step):
  - ЄДРПОУ / РНОКПП / IBAN checksums;
  - if the AI mistyped an IBAN, the correct one is recovered from the source text (Levenshtein ≤ 3 against checksum-valid IBANs in the documents);
  - our own company is never written into the client/carrier fields;
  - ФОП vs ТОВ rules (basis «Виписки з ЄДР» vs «Статуту», director = the ФОП himself);
  - name casing, short names (ТОВ «…», ФОП …, Прізвище І.П.);
  - margin check (warns on loss or margin < 8%), VAT handling per carrier tax status.
- **2 legal entities × 2 contract types**, templates in Google Docs with 40+ `{{PLACEHOLDERS}}`.
- **Resilient:** retries on every external call (Telegram downloads, OpenAI, Google), plus an error workflow that apologises to the manager and sends the admin the failed node, the error and a link to the execution.

---

## 🏗️ Architecture

```
Telegram ──► Template Config ──► Get Session (Sheets: Sessions_v2)
                                      │
                         Route by Step (Switch)
   ┌──────────┬──────────┬────────────┼──────────────┬───────────┐
  /start    cancel    side button   input          ✅ Готово     review edit
   │                     │            │                │            │
 choose company      Set Side     media router      Get Inputs   Normalize Text
 & role              (client /    voice → Whisper   (Sheets)        │
   │                 carrier)     photo → Vision       │            │
 new batch_id                     pdf  → OpenAI        └──► Build AI Request ◄┘
                                  docx → Drive→Docs          │  (extract | patch)
                                      │                  OpenAI (json_schema, strict)
                                Append to Inputs             │
                                (kind:side, text)        Post-process  ← checksums, IBAN fix,
                                                             │            business rules
                                                        Review Screen ──► Telegram
                                                             │
                                                  🚀 Генерувати (callback)
                                                             │
                                                      Generate Items (1–2 docs)
                                                             │
                                          Contract Generate (sub-workflow, per doc):
                                          copy template → batchUpdate replace →
                                          export .docx → send to Telegram → delete copy
```

| Workflow | Nodes | Role |
|---|---|---|
| `contract_bot_v2.json` | 74 | Conversation, input collection, AI extraction, review |
| `contract_generate.json` | 8 | Builds one `.docx` from a template and sends it |
| `contract_bot_error_handler.json` | 7 | Catches failures, notifies manager + admin |

The business logic lives in 5 plain JavaScript files (`v2/01…05-*.js`) that are pasted into n8n Code nodes **and** unit-tested locally without n8n (`node v2/test-local.js`). The workflows themselves are generated from code (`v2/build/build_v2.js`), so the n8n JSON is reproducible instead of hand-edited.

---

## 🛠️ Tech stack

| Layer | Tool |
|---|---|
| Automation | n8n 2.x (self-hosted on Railway, Postgres) |
| Messenger | Telegram Bot API |
| AI extraction | OpenAI GPT-4.1-mini, `response_format: json_schema` (strict) |
| Voice / images / PDF | Whisper · GPT-4o Vision · OpenAI file input |
| Word → text | Google Drive conversion to Google Docs |
| Templates & output | Google Docs `batchUpdate` → `.docx` export |
| State | Google Sheets (`Sessions_v2`, `Inputs`) |

---

## 💡 Engineering decisions worth mentioning

- **AI extracts, code decides.** The model only fills a strict JSON schema. Everything that must be correct (checksums, which side a company belongs to, our own details, VAT, margins) is enforced in deterministic code afterwards — and covered by tests.
- **Batch, then one AI call.** Collecting all inputs first and extracting once is cheaper and more accurate than parsing message-by-message: the model sees the extract, the bank letter and the voice note together and can resolve conflicts.
- **Side captured at receipt time.** Each input stores the side that was active when it arrived, so out-of-order processing of files (Telegram downloads finish at different times) cannot misplace a document.
- **Patch mode for corrections.** On the review step the same request builder sends current data + the new message and asks the model to change only what was asked.
- **Workflows as build artefacts.** A Node script generates both workflows, applies retries to every external node and refuses to build if credentials are mixed or v1 leftovers remain.
- **No personal data in the repo.** Test fixtures use fictional companies, valid-but-fake IBANs and tax codes; secrets live only in n8n credentials.

---

## 🚀 Run it yourself

1. **n8n** (any instance) and credentials: Telegram API, Google Sheets / Drive / Docs OAuth2, OpenAI (+ HTTP Header Auth `Authorization: Bearer …` for raw OpenAI calls).
2. **Google Sheets:** sheet `Sessions_v2` with columns `chat_id | step | company | role | data | updated_at | raw_input | batch_id`; sheet `Inputs` with `chat_id | batch_id | kind | name | text | created_at`.
3. **Templates:** Google Docs with `{{PLACEHOLDER}}` fields (list in `v2/01-template-config.js` → `FIELDS`), template IDs in `TEMPLATES`.
4. **Import** `workflows/contract_generate.json`, then `contract_bot_v2.json`, then `contract_bot_error_handler.json`. Re-link credentials, the spreadsheet and the sub-workflow in **Execute Workflow**; set the error handler in Contract Bot v2 → Settings → Error Workflow.
5. Publish, send `/start` to the bot.

Rebuild the workflows after changing code: `node v2/build/build_v2.js <ContractGenerateWorkflowId>`.

---

## 📁 Repository

```
workflows/            n8n exports (v2 + error handler); v1/ — first version, archived
v2/01…05-*.js         Code-node logic: config, AI request, post-process, review, generation
v2/test-local.js      tests for the Code nodes without n8n
v2/build/             workflow generator
docs/                 v2 architecture notes, screenshots
```

---

## 🕓 History

- **v1 (2025):** step-by-step dialogue, three separate AI parsers (company / carrier / route), one contract per run.
- **v2 (Nov 2026):** batch input from any sources, both contracts per trip, review & voice corrections, checksum validation with IBAN self-correction, retries, error workflow, workflows generated from code.

---

## 👤 Author

**Yevhen** — logistics manager turned automation engineer: n8n, AI integration, business-process automation.

## 📄 License

MIT
