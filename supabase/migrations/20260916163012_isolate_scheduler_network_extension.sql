-- Keep the installed extension intact; only the postgres-owned scheduler needs it.
revoke all on schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;
