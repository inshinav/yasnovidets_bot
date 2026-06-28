"""Шаг 1 петля: getUpdates с offset=last_update_id+1, печатает апдейты в stdout (JSON)."""
import json
import os
import sys
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_env import ensure_token_env

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    token = ensure_token_env()
    if not token:
        print(json.dumps({"error": "no_token"}))
        sys.exit(2)
    with open(os.path.join(ROOT, "state.json"), encoding="utf-8") as f:
        state = json.load(f)
    offset = state.get("last_update_id", 0) + 1
    payload = {
        "offset": offset,
        "timeout": 0,
        "allowed_updates": ["message", "poll_answer", "message_reaction"],
    }
    req = urllib.request.Request(
        "https://api.telegram.org/bot%s/getUpdates" % token,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        resp = json.load(e)
    if not resp.get("ok"):
        print(json.dumps({"ok": False, "description": resp.get("description")}, ensure_ascii=False))
        sys.exit(1)
    updates = resp.get("result", [])
    # компактная сводка для разбора
    out = []
    for u in updates:
        item = {"update_id": u.get("update_id"), "keys": [k for k in u.keys() if k != "update_id"]}
        if "message" in u:
            m = u["message"]
            item["message"] = {
                "message_id": m.get("message_id"),
                "from": (m.get("from") or {}).get("first_name"),
                "text": m.get("text"),
                "reply_to": (m.get("reply_to_message") or {}).get("message_id"),
            }
        if "message_reaction" in u:
            mr = u["message_reaction"]
            item["reaction"] = {
                "message_id": mr.get("message_id"),
                "user": (mr.get("user") or {}).get("first_name"),
                "new": [r.get("emoji") for r in mr.get("new_reaction", [])],
            }
        if "poll_answer" in u:
            item["poll_answer"] = u["poll_answer"]
        out.append(item)
    print(json.dumps({"ok": True, "count": len(updates), "offset_used": offset, "updates": out}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
