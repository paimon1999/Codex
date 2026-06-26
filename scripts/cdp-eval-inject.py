#!/usr/bin/env python3
"""
CDP debug script: manually evaluate renderer-inject.js in a Chrome page
via Chrome DevTools Protocol to see if it executes and to debug issues.
"""

import json
import sys
import subprocess
import urllib.request

# Bypass proxy for localhost connections
import os
os.environ["no_proxy"] = os.environ.get("no_proxy", "") + ",127.0.0.1,localhost"
_proxy_handler = urllib.request.ProxyHandler({})
_opener = urllib.request.build_opener(_proxy_handler)

# ── 0. Ensure websockets is installed ────────────────────────────────────────
try:
    import websockets.sync.client
except ImportError:
    print("[*] websockets not found, installing...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "websockets"])
    # Ensure user site-packages is on sys.path (pip --user installs there)
    import site
    user_sp = site.getusersitepackages()
    if user_sp and user_sp not in sys.path:
        sys.path.insert(0, user_sp)
    import websockets.sync.client

CDP_HTTP = "http://127.0.0.1:9229/json"
SCRIPT_PATH = "/Users/paimon/Rustrover/Codex/assets/inject/renderer-inject.js"

# ── 1. Get CDP target list ──────────────────────────────────────────────────
print(f"[1] Fetching CDP target list from {CDP_HTTP} ...")
try:
    with _opener.open(CDP_HTTP, timeout=5) as resp:
        targets = json.loads(resp.read().decode())
except Exception as e:
    print(f"  FAILED to connect: {e}")
    sys.exit(1)

print(f"  Found {len(targets)} target(s)")

# ── 2. Find the page target ─────────────────────────────────────────────────
page_target = None
for t in targets:
    ttype = t.get("type", "")
    print(f"  - id={t.get('id','?')[:12]}  type={ttype:10s}  title={t.get('title','')[:60]}")
    if ttype == "page" and page_target is None:
        page_target = t

if page_target is None:
    print("  ERROR: no target with type='page' found!")
    sys.exit(1)

ws_url = page_target.get("webSocketDebuggerUrl")
if not ws_url:
    print("  ERROR: page target has no webSocketDebuggerUrl")
    sys.exit(1)

print(f"\n[2] Selected page target:")
print(f"    id    : {page_target.get('id')}")
print(f"    title : {page_target.get('title')}")
print(f"    url   : {page_target.get('url')}")
print(f"    ws    : {ws_url}")

# ── 3. Read the injection script ────────────────────────────────────────────
print(f"\n[3] Reading injection script from {SCRIPT_PATH} ...")
try:
    with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
        script_full = f.read()
except Exception as e:
    print(f"  FAILED to read: {e}")
    sys.exit(1)

print(f"  Script length: {len(script_full)} chars")

script_preview = script_full[:200]
print(f"  First 200 chars:\n    {script_preview!r}")

# For evaluation we use up to 500 chars as a quick test first
# Always send the full script; CDP WebSocket handles large payloads fine
eval_script = script_full
print(f"  Will evaluate: FULL script ({len(eval_script)} chars)")

# ── 4. Connect via WebSocket and evaluate ────────────────────────────────────
msg_id = 0

def next_id():
    global msg_id
    msg_id += 1
    return msg_id

def send_and_recv(ws, method, params=None):
    mid = next_id()
    payload = {"id": mid, "method": method}
    if params:
        payload["params"] = params
    msg = json.dumps(payload)
    print(f"\n>>> Sending (id={mid}): {method}")
    if params and "expression" in params:
        expr = params["expression"]
        if len(expr) > 120:
            print(f"    expression ({len(expr)} chars): {expr[:120]}...")
        else:
            print(f"    expression: {expr}")
    ws.send(msg)
    resp_raw = ws.recv()
    resp = json.loads(resp_raw)
    return resp

print(f"\n[4] Connecting to WebSocket: {ws_url}")
try:
    ws = websockets.sync.client.connect(ws_url, max_size=2**26)  # 64MB
except Exception as e:
    print(f"  FAILED to connect: {e}")
    sys.exit(1)

print("  Connected!")

try:
    # ── 5. Evaluate the injection script ─────────────────────────────────────
    print("\n" + "=" * 70)
    print("[5] EVALUATING INJECTION SCRIPT via Runtime.evaluate")
    print("=" * 70)

    resp = send_and_recv(ws, "Runtime.evaluate", {
        "expression": eval_script,
        "awaitPromise": False,
        "allowUnsafeEvalBlockedByCSP": True,
        "returnByValue": True,
    })

    print("\n>>> FULL RESPONSE JSON:")
    print(json.dumps(resp, indent=2, ensure_ascii=False))

    result = resp.get("result", {})
    exception_details = result.get("exceptionDetails")

    if exception_details:
        print("\n!!! EXCEPTION DETAILS !!!")
        print(json.dumps(exception_details, indent=2, ensure_ascii=False))
        text = exception_details.get("text", "")
        desc = exception_details.get("exception", {}).get("description", "")
        print(f"\n  Exception text       : {text}")
        print(f"  Exception description: {desc[:300]}")
    else:
        val = result.get("result", {}).get("value")
        vtype = result.get("result", {}).get("type")
        print(f"\n  No exception.  result.type={vtype}  result.value={val!r}")

    # ── 6. Check globals ─────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("[6] CHECKING GLOBALS after injection")
    print("=" * 70)

    checks = [
        "typeof window.__UCODEX_VERSION__",
        "typeof window.__CODEX_SESSION_DELETE_HELPER__",
        "window.__UCODEX_VERSION__",
        "window.__CODEX_SESSION_DELETE_HELPER__",
        "typeof window.__codex_delete_helper_base",
    ]

    for expr in checks:
        r = send_and_recv(ws, "Runtime.evaluate", {
            "expression": expr,
            "awaitPromise": False,
        })
        val = r.get("result", {}).get("result", {}).get("value")
        vtype = r.get("result", {}).get("result", {}).get("type")
        exc = r.get("result", {}).get("exceptionDetails")
        status = "EXCEPTION" if exc else "OK"
        print(f"  {expr:50s} => type={vtype:10s} value={val!r:30s} [{status}]")

    print("\n" + "=" * 70)
    print("[DONE]")
    print("=" * 70)

finally:
    ws.close()
