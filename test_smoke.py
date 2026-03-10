"""Smoke test for mnemon-mcp MCP server."""
import json
import os
import shutil
import subprocess
import sys
import time

DB_PATH = os.path.expanduser("~/.mnemon-mcp/memory.db")

# Clean previous test DB
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

MESSAGES = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0"},
    }},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "memory_add",
        "arguments": {
            "content": "Никита практикует випассану с 2024 года, прошёл 5 ретритов",
            "layer": "semantic",
            "title": "Vipassana practice",
            "entity_type": "user",
            "entity_name": "nikita",
            "confidence": 0.95,
            "importance": 0.8,
        },
    }},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
        "name": "memory_add",
        "arguments": {
            "content": "Любимая еда — том ям и зелёный карри",
            "layer": "semantic",
            "title": "Food preferences",
            "entity_type": "user",
            "entity_name": "nikita",
        },
    }},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
        "name": "memory_search",
        "arguments": {"query": "випассана ретрит"},
    }},
    {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {
        "name": "memory_search",
        "arguments": {"query": "еда карри", "layers": ["semantic"]},
    }},
    {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {
        "name": "memory_inspect",
        "arguments": {},
    }},
    {"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {
        "name": "memory_update",
        "arguments": {"id": "__PLACEHOLDER__", "importance": 1.0},
    }},
]

LABELS = {
    1: "init",
    2: "tools/list",
    3: "add (vipassana)",
    4: "add (food)",
    5: "search (випассана)",
    6: "search (еда карри)",
    7: "inspect (stats)",
    8: "update (importance)",
}

# Build
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)
print("Building...")
subprocess.run(["npm", "run", "build"], capture_output=True, check=True)

print("=== Smoke Test ===\n")

# Start server
proc = subprocess.Popen(
    ["node", "dist/index.js"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

results = {}
vipassana_id = None

try:
    for msg in MESSAGES:
        # Replace placeholder with real ID
        if msg["id"] == 8 and vipassana_id:
            msg["params"]["arguments"]["id"] = vipassana_id
        elif msg["id"] == 8 and not vipassana_id:
            print("SKIP [update]: no vipassana_id captured")
            continue

        line = json.dumps(msg, ensure_ascii=False) + "\n"
        proc.stdin.write(line.encode())
        proc.stdin.flush()
        time.sleep(0.3)

        # Read response
        resp_line = proc.stdout.readline().decode().strip()
        if not resp_line:
            print(f"FAIL [{LABELS.get(msg['id'], '?')}]: empty response")
            continue

        try:
            resp = json.loads(resp_line)
        except json.JSONDecodeError:
            print(f"FAIL [{LABELS.get(msg['id'], '?')}]: invalid JSON: {resp_line[:100]}")
            continue

        rid = resp.get("id", "?")
        label = LABELS.get(rid, f"id={rid}")

        if "error" in resp:
            print(f"FAIL [{label}]: {resp['error']}")
            continue

        r = resp.get("result", {})

        if "serverInfo" in r:
            print(f"OK   [{label}]: {r['serverInfo']['name']} v{r['serverInfo']['version']}")
        elif "tools" in r:
            names = [t["name"] for t in r["tools"]]
            print(f"OK   [{label}]: {len(names)} tools — {names}")
        elif "content" in r:
            for c in r["content"]:
                if c["type"] == "text":
                    inner = json.loads(c["text"])
                    if "id" in inner and "layer" in inner:
                        mid = inner["id"]
                        print(f"OK   [{label}]: id={mid[:12]}... layer={inner['layer']}")
                        if rid == 3:
                            vipassana_id = mid
                    elif "memories" in inner:
                        n = len(inner["memories"])
                        scores = [m.get("score", 0) for m in inner["memories"]]
                        top = scores[0] if scores else 0
                        qt = inner.get("query_time_ms", "?")
                        print(f"OK   [{label}]: {n} results, top_score={top:.3f}, time={qt}ms")
                    elif "layer_stats" in inner:
                        stats = inner["layer_stats"]
                        total = sum(s.get("total", 0) for s in stats.values())
                        active = sum(s.get("active", 0) for s in stats.values())
                        print(f"OK   [{label}]: {total} total, {active} active, layers={list(stats.keys())}")
                    elif "updated_id" in inner:
                        print(f"OK   [{label}]: updated_id={inner['updated_id'][:12]}...")
                    else:
                        print(f"OK   [{label}]: {json.dumps(inner, ensure_ascii=False)[:200]}")
        else:
            print(f"OK   [{label}]: {json.dumps(r, ensure_ascii=False)[:200]}")

        results[rid] = resp

finally:
    proc.stdin.close()
    proc.terminate()
    proc.wait(timeout=5)

print(f"\n=== {len(results)} / {len(MESSAGES)} passed ===")

# DB check
if os.path.exists(DB_PATH):
    size = os.path.getsize(DB_PATH)
    print(f"DB: {DB_PATH} ({size // 1024}KB)")
else:
    print("WARN: DB file not found")
