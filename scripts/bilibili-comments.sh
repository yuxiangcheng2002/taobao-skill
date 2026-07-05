#!/usr/bin/env bash
# Fetch top comments (+ nested replies) for a Bilibili video by BV-id.
# Usage: bilibili-comments.sh <BV-id> [max-top-comments]
# No login required. Sorted by like count (mode=3).
set -euo pipefail

BVID="${1:?usage: bilibili-comments.sh <BV-id> [max-top-comments]}"
LIMIT="${2:-20}"

python3 - "$BVID" "$LIMIT" <<'PY'
import json, sys, datetime, urllib.request

bvid, limit = sys.argv[1], int(sys.argv[2])
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://www.bilibili.com",
}

def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

view = get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
code = view.get("code")
if code == 62012:
    sys.exit("error: video is private (code 62012)")
if code != 0 or not view.get("data"):
    sys.exit(f"error: view API failed (code {code}: {view.get('message')})")

v = view["data"]
pub = datetime.datetime.fromtimestamp(v["pubdate"]).strftime("%Y-%m")
print(f"# {v['title']} | {v['stat']['view']} views | {pub} | up: {v['owner']['name']}")

reply = get(f"https://api.bilibili.com/x/v2/reply/main?type=1&oid={v['aid']}&mode=3")
if reply.get("code") != 0:
    sys.exit(f"error: reply API failed (code {reply.get('code')}: {reply.get('message')})")

reps = (reply.get("data") or {}).get("replies") or []
if not reps:
    print("(no comments returned)")
for r in reps[:limit]:
    msg = r["content"]["message"].replace("\n", " ")
    print(f"--- {r['like']} likes | {msg}")
    for rr in (r.get("replies") or [])[:3]:
        sub = rr["content"]["message"].replace("\n", " ")[:200]
        print(f"    > {sub}")
PY
