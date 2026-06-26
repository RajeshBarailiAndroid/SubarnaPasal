# Auto-save live gold rate to Supabase (only when price changes)

Supabase **cannot** call external APIs (GoldAPI, etc.) by itself. This app uses:

1. **Vercel Cron** (recommended) — calls your app every minute  
2. **Your Node server** — fetches the live metal API and writes to `shared_gold_rates` in Supabase  
3. **Save rule** — database is updated **only when the gold price changes**

## Setup (Vercel)

1. Run `supabase/shared-gold-rates.sql` in Supabase SQL Editor (if not done).
2. In **Vercel → Settings → Environment Variables**, add:
   - `CRON_SECRET` — random secret (`openssl rand -hex 32`)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   - `METAL_PRICE_PROVIDER=gold-api` (or your API key provider)
3. Deploy. `vercel.json` runs `/api/cron/capture-gold-rate` every **minute**.
4. Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.

## Test manually

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://your-app.vercel.app/api/cron/capture-gold-rate"
```

Response when price unchanged:

```json
{ "ok": true, "changed": false, "goldRatePerTola": 185000, ... }
```

Response when price changed:

```json
{ "ok": true, "changed": true, "goldRatePerTola": 185500, ... }
```

## Optional: trigger from Supabase (pg_cron + pg_net)

If you prefer Supabase to **schedule** the job (still calls your app, not the metal API directly):

1. Enable extensions: `pg_cron`, `pg_net`
2. In SQL Editor:

```sql
select cron.schedule(
  'capture-gold-rate',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_APP.vercel.app/api/cron/capture-gold-rate',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    )
  );
  $$
);
```

Replace `YOUR_APP` and `YOUR_CRON_SECRET`.

## Browser vs server

| Source | Chart (every second) | Database save |
|--------|----------------------|---------------|
| Browser open | Live UI updates each second | Only when price **changes** |
| Vercel Cron | — | Every minute, only if price **changed** |

Data is stored in `shared_gold_rates` — **same for all users**.
