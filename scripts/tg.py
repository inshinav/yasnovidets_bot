"""Отправка запросов к Telegram Bot API. Токен — из env TG_BOT_TOKEN, в репозитории его нет."""
import json
import os
import sys
import urllib.request
import urllib.error


def main():
    token = os.environ.get("TG_BOT_TOKEN")
    if not token:
        print("TG_BOT_TOKEN is not set", file=sys.stderr)
        sys.exit(2)
    method = sys.argv[1]
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            payload = json.load(f)
    else:
        payload = json.load(sys.stdin)
    req = urllib.request.Request(
        "https://api.telegram.org/bot%s/%s" % (token, method),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        resp = json.load(e)
    result = resp.get("result")
    brief = {
        "ok": resp.get("ok"),
        "description": resp.get("description"),
    }
    if isinstance(result, dict):
        brief["message_id"] = result.get("message_id")
    print(json.dumps(brief, ensure_ascii=False))
    sys.exit(0 if resp.get("ok") else 1)


main()
