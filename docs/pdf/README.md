# PDF-версии выпусков

PDF собирается как отдельный печатный мини-журнал из уже готового HTML.

## Рендер

```powershell
npm run pdf:all
```

или точечно:

```powershell
node scripts/render_pdf.js docs/issues/week-2026-w24.html
```

Выход:

- `docs/pdf/issues/*.pdf` — реальные выпуски;
- `docs/pdf/samples/*.pdf` — демо-форматы шести горизонтов.

Если GitHub Pages появится, перед рендером можно задать публичную базу для QR:

```powershell
$env:YASNO_ARCHIVE_BASE_URL = "https://<user>.github.io/yasnovidets/"
```

Без неё QR кодирует локальный путь HTML внутри архива, например `docs/issues/week-2026-w24.html`.

## Telegram-порядок

Для выпуска с PDF используйте:

```powershell
python scripts/send_issue_with_pdf.py .out/payload.json
```

`payload.json`:

```json
{
  "header": ".out/header.json",
  "html": "docs/issues/week-2026-w24.html",
  "pdf": "docs/pdf/issues/week-2026-w24.pdf",
  "pdf_caption": "📎 PDF-версия выпуска\nУдобно читать, сохранить и переслать. HTML-версия — по кнопке выше.",
  "quiz": ".out/quiz.json",
  "ideas_poll": ".out/ideas_poll.json"
}
```

Порядок отправки:

1. короткая Telegram-шапка;
2. PDF как `sendDocument`, `reply_to_message_id` к шапке;
3. quiz, если задан;
4. опрос идей, если задан.

PDF best-effort: ошибка сборки или загрузки PDF не блокирует выпуск.
Если PDF не собрался или не загрузился, скрипт отправляет reply к шапке:

```text
PDF сегодня не собрался: <причина>
```

Для проверки порядка без отправки в Telegram:

```powershell
python scripts/send_issue_with_pdf.py --dry-run .out/payload.json
```
