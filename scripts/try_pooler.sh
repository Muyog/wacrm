#!/usr/bin/env bash
# Try pooler connection variants for Supabase hosted migrations
cd /c/Users/USER/wacrm

echo "=== A: postgres.ref @5432 session pooler ==="
timeout 30 /c/Users/USER/bin/supabase.exe db push --db-url "postgresql://postgres.dhfsonubhystmwryfqbv:BAMIsoro@@2026@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" 2>&1 | head -3

echo "=== B: postgres @5432 ==="
timeout 30 /c/Users/USER/bin/supabase.exe db push --db-url "postgresql://postgres:BAMIsoro@@2026@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" 2>&1 | head -3

echo "=== C: ref-only user ==="
timeout 30 /c/Users/USER/bin/supabase.exe db push --db-url "postgresql://dhfsonubhystmwryfqbv:BAMIsoro@@2026@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" 2>&1 | head -3