"""
Apply 042_live_calls.sql to hosted Supabase.
Tries management API (needs SUPABASE_ACCESS_TOKEN), else psql via pooler (needs PGPASSWORD).
Prints a clear verdict either way.
"""
import os
import sys
import json
import urllib.request
import urllib.error

WACRM = r"C:\Users\USER\wacrm"
PROJECT_REF = "dhfsonubhystmwryfqbv"
MIGRATION = os.path.join(WACRM, "supabase", "migrations", "042_live_calls.sql")

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def try_management_api(sql, token):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return True, r.status, r.read()[:400].decode(errors="replace")
    except urllib.error.HTTPError as e:
        return False, e.code, e.read()[:600].decode(errors="replace")

def main():
    sql = open(MIGRATION).read()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        for p in (os.path.expanduser("~/.env"), os.path.join(WACRM, ".env.local")):
            try:
                token = load_env(p).get("SUPABASE_ACCESS_TOKEN", "").strip()
                if token: break
            except FileNotFoundError:
                pass
    if token:
        ok, code, body = try_management_api(sql, token)
        print("management-api:", "OK" if ok else "ERR", code, body)
        if ok:
            print("VERDICT: applied via management API")
            return
    print("VERDICT: could not apply automatically — need SUPABASE_ACCESS_TOKEN or DB password")

if __name__ == "__main__":
    main()
