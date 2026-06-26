#!/usr/bin/env python3
"""CDP Debug Script - Connects to Chrome DevTools Protocol at port 9229."""

import json
import socket
import base64
import os
import struct
import time
import subprocess
from urllib.parse import urlparse


def get_targets():
    """Get target list from CDP /json endpoint using curl to bypass proxy."""
    print("[*] Fetching targets from http://127.0.0.1:9229/json (curl --noproxy)")
    result = subprocess.run(
        ["curl", "--noproxy", "127.0.0.1", "-s", "http://127.0.0.1:9229/json"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise RuntimeError(f"curl failed: {result.stderr}")
    data = json.loads(result.stdout)
    print(f"[*] Found {len(data)} targets")
    for t in data:
        print(f"    - type={t.get('type')}, title={t.get('title')}, id={t.get('id')}")
    return data


def find_page_target(targets):
    """Find the page target and return its webSocketDebuggerUrl."""
    for t in targets:
        if t.get("type") == "page":
            url = t.get("webSocketDebuggerUrl")
            if url:
                print(f"[*] Found page target: {t.get('title')}")
                print(f"[*] WebSocket URL: {url}")
                return url
    raise RuntimeError("No page target with webSocketDebuggerUrl found")


class RawWebSocket:
    """Minimal WebSocket client using raw sockets (RFC 6455)."""

    def __init__(self, url: str):
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        path = parsed.path or "/"

        self._sock = socket.create_connection((host, port), timeout=10)
        if parsed.scheme == "wss":
            import ssl
            ctx = ssl.create_default_context()
            self._sock = ctx.wrap_socket(self._sock, server_hostname=host)

        # WebSocket handshake
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"\r\n"
        )
        self._sock.sendall(handshake.encode())

        # Read response until we get \r\n\r\n
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise ConnectionError("Connection closed during handshake")
            resp += chunk

        if b"101" not in resp.split(b"\r\n")[0]:
            raise RuntimeError(f"Handshake failed: {resp.decode(errors='replace')}")

    def send(self, data: str):
        """Send a text frame."""
        payload = data.encode("utf-8")
        mask = os.urandom(4)
        frame = bytearray()
        frame.append(0x81)  # FIN + TEXT
        length = len(payload)
        if length < 126:
            frame.append(0x80 | length)
        elif length < 65536:
            frame.append(0x80 | 126)
            frame.extend(struct.pack("!H", length))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack("!Q", length))
        frame.extend(mask)
        masked = bytearray(len(payload))
        for i in range(len(payload)):
            masked[i] = payload[i] ^ mask[i % 4]
        frame.extend(masked)
        self._sock.sendall(bytes(frame))

    def recv(self) -> str:
        """Receive a text frame."""
        header = self._recv_exact(2)
        opcode = header[0] & 0x0F
        masked = bool(header[1] & 0x80)
        length = header[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask_key = self._recv_exact(4) if masked else None
        payload = self._recv_exact(length)
        if masked and mask_key:
            payload = bytes(payload[i] ^ mask_key[i % 4] for i in range(len(payload)))
        if opcode == 0x08:
            raise ConnectionError("WebSocket closed")
        return payload.decode("utf-8")

    def _recv_exact(self, n: int) -> bytes:
        data = b""
        while len(data) < n:
            chunk = self._sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("Connection closed")
            data += chunk
        return data

    def close(self):
        try:
            self._sock.close()
        except Exception:
            pass


def send_cdp(ws, method, params=None, msg_id=None, _counter={"n": 1}):
    """Send a CDP command and return the response."""
    if msg_id is None:
        msg_id = _counter["n"]
        _counter["n"] += 1
    cmd = {"id": msg_id, "method": method}
    if params:
        cmd["params"] = params
    ws.send(json.dumps(cmd))
    while True:
        raw = ws.recv()
        msg = json.loads(raw)
        if msg.get("id") == msg_id:
            return msg


def extract_result_value(response):
    """Extract the value from a Runtime.evaluate response."""
    try:
        result = response["result"]["result"]
        if result.get("type") == "undefined":
            return "<undefined>"
        val = result.get("value", result.get("description", str(result)))
        return val
    except (KeyError, TypeError):
        return f"<unexpected format: {json.dumps(response, indent=2)}>"


def main():
    print("=" * 60)
    print("CDP Debug Script - Checking Codex renderer injection")
    print("=" * 60)

    # Step 1: Get targets
    targets = get_targets()

    # Step 2: Find page target
    ws_url = find_page_target(targets)

    # Step 3: Connect via WebSocket
    print(f"\n[*] Connecting to WebSocket...")
    ws = RawWebSocket(ws_url)
    print("[*] Connected!")

    try:
        # Step 4: Send CDP commands
        print("\n" + "=" * 60)
        print("Step 4: Checking window globals and DOM state")
        print("=" * 60)

        checks = [
            ("4a", "typeof window.__codexSessionDeleteBridge", "Bridge existence"),
            ("4b", "typeof window.__UCODEX_VERSION__", "Renderer script ran"),
            ("4c", "typeof window.__CODEX_SESSION_DELETE_HELPER__", "Helper URL"),
            ("4d", "window.__UCODEX_BUILD__", "Build info"),
            ("4e", 'document.getElementById("ucodex-menu") !== null', "Menu element exists"),
            ("4f", 'window.getComputedStyle(document.documentElement).getPropertyValue("--ucodex-accent")', "CSS var --ucodex-accent"),
        ]

        for label, expr, desc in checks:
            resp = send_cdp(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True})
            val = extract_result_value(resp)
            print(f"  [{label}] {desc}: {val}")

        # Step 5: Manually evaluate renderer script snippet
        print("\n" + "=" * 60)
        print("Step 5: Manual renderer script snippet evaluation")
        print("=" * 60)

        snippet = r"""
try {
  window.__UCODEX_VERSION__ = "test-manual";
  window.__CODEX_SESSION_DELETE_HELPER__ = "http://127.0.0.1:57321";
  "ok";
} catch(e) {
  "error: " + e.message;
}
"""
        resp = send_cdp(ws, "Runtime.evaluate", {"expression": snippet, "returnByValue": True})
        val = extract_result_value(resp)
        print(f"  Snippet result: {val}")

        resp = send_cdp(ws, "Runtime.evaluate", {"expression": 'window.__UCODEX_VERSION__', "returnByValue": True})
        val = extract_result_value(resp)
        print(f"  Verify __UCODEX_VERSION__ after manual set: {val}")

        # Step 6: Check sendUcodexDiagnostic
        print("\n" + "=" * 60)
        print("Step 6: Check sendUcodexDiagnostic function")
        print("=" * 60)

        resp = send_cdp(ws, "Runtime.evaluate", {"expression": "typeof sendUcodexDiagnostic", "returnByValue": True})
        val = extract_result_value(resp)
        print(f"  typeof sendUcodexDiagnostic: {val}")

        # Step 7: Enable Runtime/Console and check for messages
        print("\n" + "=" * 60)
        print("Step 7: Enable Runtime/Console and collect recent messages")
        print("=" * 60)

        collected_events = []

        send_cdp(ws, "Runtime.enable")
        print("  Runtime.enable sent")

        send_cdp(ws, "Console.enable")
        print("  Console.enable sent")

        log_snippet = 'console.log("CDP_DEBUG_TEST_MESSAGE"); "logged"'
        resp = send_cdp(ws, "Runtime.evaluate", {"expression": log_snippet, "returnByValue": True})
        val = extract_result_value(resp)
        print(f"  console.log test: {val}")

        print("  Draining pending events (2s)...")
        ws._sock.settimeout(0.5)
        deadline = time.time() + 2
        while time.time() < deadline:
            try:
                raw = ws.recv()
                msg = json.loads(raw)
                if "method" in msg:
                    method = msg["method"]
                    params = msg.get("params", {})
                    if method == "Runtime.consoleAPICalled":
                        args = params.get("args", [])
                        text = " ".join(a.get("value", a.get("description", "")) for a in args)
                        print(f"    [Console] {params.get('type', 'log')}: {text}")
                        collected_events.append(msg)
                    elif method == "Runtime.exceptionThrown":
                        print(f"    [Exception] {json.dumps(params, indent=4)}")
                        collected_events.append(msg)
                    elif method == "Console.messageAdded":
                        cm = params.get("message", {})
                        print(f"    [Console Added] {cm.get('level', '?')}: {cm.get('text', '')}")
                        collected_events.append(msg)
                    else:
                        print(f"    [Event] {method}")
            except socket.timeout:
                continue
        ws._sock.settimeout(10)

        if not collected_events:
            print("  No console events captured.")

        send_cdp(ws, "Runtime.disable")
        send_cdp(ws, "Console.disable")
        print("  Runtime.disable / Console.disable sent")

        print("\n" + "=" * 60)
        print("DONE")
        print("=" * 60)

    finally:
        ws.close()
        print("[*] Connection closed.")


if __name__ == "__main__":
    main()
