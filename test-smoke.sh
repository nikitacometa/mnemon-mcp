#!/usr/bin/env bash
# Smoke test for mnemon-mcp MCP server
set -eu
cd "$(dirname "$0")"

# Clean previous test DB
rm -f ~/.mnemon-mcp/memory.db

# Build
npm run build 2>&1 | tail -1

echo "=== Smoke Test ==="

# Send multiple JSON-RPC messages, collect output
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_add","arguments":{"content":"Никита практикует випассану с 2024 года, прошёл 5 ретритов","layer":"semantic","title":"Vipassana practice","entity_type":"user","entity_name":"nikita","confidence":0.95,"importance":0.8}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_add","arguments":{"content":"Любимая еда — том ям и зелёный карри","layer":"semantic","title":"Food preferences","entity_type":"user","entity_name":"nikita"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"випассана ретрит"}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"еда карри","layers":["semantic"]}}}'
  sleep 0.5
  echo '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"memory_inspect","arguments":{}}}'
  sleep 0.5
} | node dist/index.js 2>/dev/null | python3 -c "
import sys, json

LABELS = {
    1: 'init',
    2: 'tools/list',
    3: 'add (vipassana)',
    4: 'add (food)',
    5: 'search (випассана)',
    6: 'search (еда карри)',
    7: 'inspect (stats)',
}

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        rid = d.get('id', '?')
        label = LABELS.get(rid, f'id={rid}')
        if 'error' in d:
            print(f'FAIL [{label}]: {d[\"error\"]}')
            continue
        r = d.get('result', {})
        if 'serverInfo' in r:
            print(f'OK   [{label}]: {r[\"serverInfo\"][\"name\"]} v{r[\"serverInfo\"][\"version\"]}')
        elif 'tools' in r:
            names = [t['name'] for t in r['tools']]
            print(f'OK   [{label}]: {len(names)} tools — {names}')
        elif 'content' in r:
            for c in r['content']:
                if c['type'] == 'text':
                    inner = json.loads(c['text'])
                    # Summarize
                    if 'id' in inner and 'layer' in inner:
                        print(f'OK   [{label}]: id={inner[\"id\"][:12]}... layer={inner[\"layer\"]}')
                    elif 'memories' in inner:
                        n = len(inner['memories'])
                        scores = [m.get('score', 0) for m in inner['memories']]
                        top = scores[0] if scores else 0
                        print(f'OK   [{label}]: {n} results, top_score={top:.3f}, time={inner.get(\"query_time_ms\",\"?\")}ms')
                    elif 'layer_stats' in inner:
                        stats = inner['layer_stats']
                        total = sum(s.get('total', 0) for s in stats.values())
                        print(f'OK   [{label}]: {total} total memories, layers={list(stats.keys())}')
                    else:
                        print(f'OK   [{label}]: {json.dumps(inner, ensure_ascii=False)[:200]}')
        else:
            print(f'OK   [{label}]: {json.dumps(r, ensure_ascii=False)[:200]}')
    except Exception as e:
        print(f'ERR  parse: {e} — {line[:100]}')

print()
print('=== Smoke Test Complete ===')
"

echo ""
echo "DB size: $(ls -lh ~/.mnemon-mcp/memory.db 2>/dev/null | awk '{print $5}')"
