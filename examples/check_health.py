"""Read-only health check against an already running local WebUI."""
import json
import sys
from urllib.request import urlopen

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765'
with urlopen(base.rstrip('/') + '/api/health', timeout=5) as response:
    assert response.status == 200
    payload = json.load(response)
assert isinstance(payload, dict)
print(json.dumps(payload, ensure_ascii=False, indent=2))
