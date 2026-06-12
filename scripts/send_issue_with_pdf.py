"""Publish a Yasnovidets issue in the canonical order:

1. short Telegram header (sendMessage)
2. PDF mini-magazine as document, replying to the header
3. optional quiz (sendPoll)
4. optional ideas poll (sendPoll)

PDF upload is best-effort: if rendering/uploading fails, quiz and poll still go out.
Payload example:
{
  "header": ".out/header.json",
  "pdf": "docs/pdf/issues/week-2026-w24.pdf",
  "quiz": ".out/quiz.json",
  "ideas_poll": ".out/ideas_poll.json"
}
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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
        abs_path = os.path.join(ROOT, file_path)
        filename = os.path.basename(abs_path)
        chunks.append(("--%s\r\n" % boundary).encode())
        chunks.append(
            ('Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (key, filename)).encode()
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


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/send_issue_with_pdf.py payload.json", file=sys.stderr)
        sys.exit(2)
    cfg = load_json(sys.argv[1])
    header_result = send_json_method("sendMessage", cfg["header"])
    header_message_id = header_result["message_id"]
    header_payload = load_json(cfg["header"])
    chat_id = header_payload["chat_id"]

    pdf_path = cfg.get("pdf")
    if pdf_path:
        try:
            caption = cfg.get("pdf_caption", "PDF-версия выпуска")
            resp = bot_request(
                "sendDocument",
                {
                    "chat_id": chat_id,
                    "caption": caption,
                    "reply_to_message_id": header_message_id,
                },
                {"document": pdf_path},
            )
            brief = {"ok": resp.get("ok"), "description": resp.get("description")}
            if isinstance(resp.get("result"), dict):
                brief["message_id"] = resp["result"].get("message_id")
            print(json.dumps({"sendDocument": brief}, ensure_ascii=False))
        except Exception as exc:  # best-effort by design
            print(json.dumps({"sendDocument": {"ok": False, "description": str(exc)}}, ensure_ascii=False))

    if cfg.get("quiz"):
        send_json_method("sendPoll", cfg["quiz"])
    if cfg.get("ideas_poll"):
        send_json_method("sendPoll", cfg["ideas_poll"])


if __name__ == "__main__":
    main()
