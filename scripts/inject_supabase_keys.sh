#!/usr/bin/env bash
# Injects the local Supabase stack keys into .env.local.
set -euo pipefail
cd /c/Users/USER/wacrm

SUPABASE_BIN=/c/Users/USER/bin/supabase.exe
ENV_FILE=.env.local

echo "Fetching Supabase local stack status..."
STATUS=$("$SUPABASE_BIN" status --output env 2>/dev/null)

ANON=$(echo "$STATUS" | grep -E "^ANON_KEY=" | cut -d= -f2-)
SERVICE=$(echo "$STATUS" | grep -E "^SERVICE_ROLE_KEY=" | cut -d= -f2-)

if [ -z "$ANON" ] || [ -z "$SERVICE" ]; then
  echo "ERROR: could not read keys. Is the stack running? (supabase start)"
  echo "--- raw status ---"
  echo "$STATUS" | head -20
  exit 1
fi

echo "Anon key:      ${ANON:0:24}..."
echo "Service key:   ${SERVICE:0:24}..."

# Replace placeholder lines in place
sed -i "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON|" "$ENV_FILE"
sed -i "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SERVICE|" "$ENV_FILE"

echo "--- verification ---"
grep -E "NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY" "$ENV_FILE" | sed 's/=\(.\{20\}\).*/=\1.../'
echo "DONE: .env.local updated."
