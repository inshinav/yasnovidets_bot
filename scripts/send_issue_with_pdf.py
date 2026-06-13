"""Publish a Yasnovidets issue in the canonical order:

1. short Telegram header (sendMessage)
2. PDF mini-magazine as document, replying to the header
3. optional quiz (sendPoll)
4. optional ideas poll (sendPoll)

PDF upload is best-effort: if rendering/uploading fails, quiz and poll still go out.
Payload example:
{
  "header": ".out/header.json",
  "html": "docs/issues/week-2026-w24.html",
  "pdf": "docs/pdf/issues/week-2026-w24.pdf",
  "quiz": ".out/quiz.json",
  "ideas_poll": ".out/ideas_poll.json"
}
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_CAPTION = "📎 PDF-версия выпуска\nУдобно читать, сохранить и переслать. HTML-версия — по кнопке выше."

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass


def load_json(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return json.load(f)


def bot_request(method, payload, files=None):
    token = os.environ.get("TG_BOT_TOKEN")
    if not token:
        raise RuntimeError("TG_BOT_TOKEN is not set")
    url = "https://api.telegram.org/bot%s/%s" % (token, method)
    if files:
        body, content_type = multipart(payload, files)
        data = body
        headers = {"Content-Type": content_type}
    else:
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return json.load(e)


def multipart(fields, files):
    boundary = "yasnovidets-%s" % uuid.uuid4().hex
    chunks = []
    for key, value in fields.items():
        if value is None:
            continue
        chunks.append(("--%s\r\n" % boundary).encode())
        chunks.append(('Content-Disposition: form-data; name="%s"\r\n\r\n' % key).encode())
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    for key, file_path in files.items():
        display_name = None
        if isinstance(file_path, (tuple, list)):
            file_path, display_name = file_path
        abs_path = os.path.join(ROOT, file_path)
        # Telegram читает только обычный filename="..." (filename* игнорирует) и калечит
        # отдельные символы (тире —, иногда скобки). display_name держим в безопасном наборе.
        filename = display_name or os.path.basename(abs_path)
        chunks.append(("--%s\r\n" % boundary).encode())
        chunks.append(
            ('Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (key, filename)).encode("utf-8")
        )
        chunks.append(b"Content-Type: application/pdf\r\n\r\n")
        with open(abs_path, "rb") as f:
            chunks.append(f.read())
        chunks.append(b"\r\n")
    chunks.append(("--%s--\r\n" % boundary).encode())
    return b"".join(chunks), "multipart/form-data; boundary=%s" % boundary


def send_json_method(method, payload_path):
    payload = load_json(payload_path)
    resp = bot_request(method, payload)
    brief = {"ok": resp.get("ok"), "description": resp.get("description")}
    if isinstance(resp.get("result"), dict):
        brief["message_id"] = resp["result"].get("message_id")
    print(json.dumps(brief, ensure_ascii=False))
    if not resp.get("ok"):
        raise RuntimeError(resp.get("description") or "%s failed" % method)
    return resp["result"]


def send_pdf_error(chat_id, header_message_id, reason):
    reason = str(reason).replace(os.environ.get("TG_BOT_TOKEN", ""), "<redacted>")
    payload = {
        "chat_id": chat_id,
        "text": "PDF сегодня не собрался: %s" % reason[:700],
        "reply_to_message_id": header_message_id,
        "disable_web_page_preview": True,
    }
    resp = bot_request("sendMessage", payload)
    brief = {"ok": resp.get("ok"), "description": resp.get("description")}
    if isinstance(resp.get("result"), dict):
        brief["message_id"] = resp["result"].get("message_id")
    print(json.dumps({"pdfErrorMessage": brief}, ensure_ascii=False))


def default_pdf_for_html(html_path):
    rel = html_path.replace("\\", "/")
    name = os.path.splitext(os.path.basename(rel))[0] + ".pdf"
    if rel.startswith("docs/samples/"):
        return os.path.join("docs", "pdf", "samples", name)
    return os.path.join("docs", "pdf", "issues", name)


def ensure_pdf(cfg):
    pdf_path = cfg.get("pdf")
    html_path = cfg.get("html")
    if pdf_path and os.path.exists(os.path.join(ROOT, pdf_path)):
        return pdf_path
    if not html_path:
        if pdf_path:
            raise RuntimeError("PDF file not found: %s" % pdf_path)
        return None
    pdf_path = pdf_path or default_pdf_for_html(html_path)
    cmd = ["node", os.path.join("scripts", "render_pdf.js"), html_path]
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "render_pdf.js failed").strip()
        raise RuntimeError(msg)
    if not os.path.exists(os.path.join(ROOT, pdf_path)):
        raise RuntimeError("PDF file was not created: %s" % pdf_path)
    return pdf_path


def main():
    dry_run = "--dry-run" in sys.argv
    args = [x for x in sys.argv[1:] if x != "--dry-run"]
    if len(args) != 1:
        print("Usage: python scripts/send_issue_with_pdf.py [--dry-run] payload.json", file=sys.stderr)
        sys.exit(2)
    cfg = load_json(args[0])
    if dry_run:
        pdf_path = cfg.get("pdf") or (default_pdf_for_html(cfg["html"]) if cfg.get("html") else None)
        print(json.dumps({
            "dry_run": True,
            "order": ["sendMessage", "sendDocument", "sendPoll:quiz", "sendPoll:ideas_poll"],
            "header": cfg.get("header"),
            "html": cfg.get("html"),
            "pdf": pdf_path,
            "caption": cfg.get("pdf_caption", PDF_CAPTION),
        }, ensure_ascii=False, indent=2))
        return

    header_result = send_json_method("sendMessage", cfg["header"])
    header_message_id = header_result["message_id"]
    header_payload = load_json(cfg["header"])
    chat_id = header_payload["chat_id"]

    pdf_path = None
    try:
        pdf_path = ensure_pdf(cfg)
    except Exception as exc:
        print(json.dumps({"pdfRender": {"ok": False, "description": str(exc)[:700]}}, ensure_ascii=False))
        try:
            send_pdf_error(chat_id, header_message_id, exc)
        except Exception as notify_exc:
            print(json.dumps({"pdfErrorMessage": {"ok": False, "description": str(notify_exc)[:700]}}, ensure_ascii=False))

    if pdf_path:
        try:
            caption = cfg.get("pdf_caption", PDF_CAPTION)
            document = (pdf_path, cfg["pdf_filename"]) if cfg.get("pdf_filename") else pdf_path
            resp = bot_request(
                "sendDocument",
                {
                    "chat_id": chat_id,
                    "caption": caption,
                    "reply_to_message_id": header_message_id,
                },
                {"document": document},
            )
            brief = {"ok": resp.get("ok"), "description": resp.get("description")}
            if isinstance(resp.get("result"), dict):
                brief["message_id"] = resp["result"].get("message_id")
                brief["file_name"] = (resp["result"].get("document") or {}).get("file_name")
            print(json.dumps({"sendDocument": brief}, ensure_ascii=False))
            if not resp.get("ok"):
                raise RuntimeError(resp.get("description") or "sendDocument failed")
        except Exception as exc:  # best-effort by design
            print(json.dumps({"sendDocument": {"ok": False, "description": str(exc)}}, ensure_ascii=False))
            try:
                send_pdf_error(chat_id, header_message_id, exc)
            except Exception as notify_exc:
                print(json.dumps({"pdfErrorMessage": {"ok": False, "description": str(notify_exc)[:700]}}, ensure_ascii=False))

    if cfg.get("quiz"):
        send_json_method("sendPoll", cfg["quiz"])
    if cfg.get("ideas_poll"):
        send_json_method("sendPoll", cfg["ideas_poll"])


if __name__ == "__main__":
    main()
