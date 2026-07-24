# Field Performance — Weekly Pipeline Runbook

**Purpose:** the authoritative run-order for producing a week's Field Performance scores.
This file is GROUND TRUTH. Do not reconstruct this sequence from memory or chat history —
read it here, and if it changes, update this file in the same commit.

Last verified: 2026-07-23 (derived from endpoint read/write dependencies + run history).

- Token for all token-authed endpoints: `?token=critterstop2026`
- Offices: `DFW` (officeId 1), `ATX` (5), `OKC` (3), `CStat` (4)
- `weekEnd` = the Friday of the target week, `YYYY-MM-DD`
- Base URL: `https://hub.critterstop.com`

---

## The order (and WHY each step sits where it does)

The order is dictated by data dependencies (what each endpoint reads vs. writes),
not preference. The "depends on" column is the real constraint.

### Stage A — Customer/address layer (must run first)

1. **`/api/cron/sync-addresses`**
   Pulls customer service addresses from FieldRoutes → `customer` table. Catches new
   customers added during the week.
   *Depends on:* nothing. *Writes:* `customer`.

2. **`/api/cron/geocode`**
   Geocodes any `customer` rows missing lat/lng (Google Maps).
   *Depends on:* step 1 (needs the customer rows). *Writes:* `customer` coords.
   WHY FIRST: reliability (step 7) uses customer coordinates to detect when a tech
   arrived at a business location. No coords → no reliability.

### Stage B — FieldRoutes data pulls (populate raw tables)

3. **`/api/cron/tc-accountability`**
   WP close-out % + callback source → `tcAppointment` table.
   *Depends on:* FR sync. *Writes:* `tcAppointment`.

4. **PMP route chain — STRICT ORDER, DO NOT CHANGE:**
   ```
   /api/field-performance/week?token=critterstop2026&office=X&weekEnd=YYYY-MM-DD
   /api/field-performance/thirtyDayA?token=critterstop2026&office=X&weekEnd=YYYY-MM-DD
   /api/field-performance/thirtyDayB?token=critterstop2026&office=X&weekEnd=YYYY-MM-DD
   ```
   - `week` → production value → writes `tech_routes` + `techWeek`
   - `thirtyDayA` → completion (first half of 30-day window) → `appSetting` cache
   - `thirtyDayB` → completion (second half) → writes `techWeek`
   - **DFW split:** DFW has ~140 PMP routes/30d and `thirtyDayA` times out as one call.
     Split it into two with rangeStart/rangeEnd (no gap, no overlap):
     ```
     /api/field-performance/thirtyDayA?token=critterstop2026&office=DFW&weekEnd=YYYY-MM-DD&rangeStart=<d-14>&rangeEnd=<weekEnd>
     /api/field-performance/thirtyDayA?token=critterstop2026&office=DFW&weekEnd=YYYY-MM-DD&rangeStart=<d-6>&rangeEnd=<weekEnd>
     ```
     (2nd call MERGES with the 1st's cache before saving.)

5. **`/api/field-performance/pmpAppointments?token=critterstop2026&office=X&weekEnd=YYYY-MM-DD`**
   PMP completed appointments (rolling 90-day window) → `pmpAppointment`. Used by
   reservice attribution in `run`.
   *First-time seed only:* add `&backfill=true` (one heavy pull of full 90 days per office).

   ~~import-routes CSV~~ — **DEPRECATED & DISABLED (2026-07-23).** Production + completion now
   come entirely from the `week` endpoint (step 4). The old CSV importer wrote the same
   `techWeek` fields and would overwrite authoritative data, so it now returns HTTP 410.
   Not part of the weekly run. (Original code in git history if ever needed.)

### Stage C — Bouncie-derived (THE "LATTER PART")

These run AFTER the FR pulls. Bouncie trip data streams in continuously via
`/api/bouncie/webhook` → `bouncieTripEvent` (not a pull step).

6. **`/api/cron/bouncie`**
   Driving scores (max speed, alerts/1k mi, idle) → `techWeek.drivingScore` + raw fields.
   *Depends on:* `techWeek` rows existing (Stage B), streamed `bouncieTripEvent`.

7. **`/api/cron/reliability`**
   Attendance/punctuality → `techWeek.reliabilityScore` + `techDayAttendance`.
   *Depends on:* geocoded `customer` (step 2) + `bouncieTripEvent` + `techWeek` rows.
   WHY LATTER: needs both customer coords AND Bouncie trips to compute start/end of day.

### Stage D — Final scoring (reads DB only, no FR fetch)

8. **`/api/field-performance/run?token=critterstop2026&office=X&weekEnd=YYYY-MM-DD`**
   PMP reservice rate + revenue efficiency; finalizes PMP `techWeek` scores.
   Reads `tech_routes` + `pmpAppointment` from DB. **Computes from DB — no FR calls.**

9. **`/api/cron/field-performance`**
   WP scoring finalize (close-out/callback from `tcAppointment`). Skips PMP (handled by
   the week/thirtyDay/run chain).

✅ CONFIRMED (2026-07-23): steps 8–9 (final scoring) run AFTER bouncie/reliability, so the
final weekly score includes driving + reliability. Sequence locked.

---

## Quick weekly checklist (per office, in order)

```
[ ] 1. sync-addresses      (cron)
[ ] 2. geocode             (cron)
[ ] 3. tc-accountability   (cron)
[ ] 4. week → thirtyDayA → thirtyDayB   (token, strict order; DFW splits thirtyDayA)
[ ] 5. pmpAppointments     (token)
[ ] 6. bouncie             (cron)      ← "latter part"
[ ] 7. reliability         (cron)      ← "latter part"
[ ] 8. run                 (token, PMP final scoring)
[ ] 9. field-performance   (cron, WP final scoring)
    (import-routes CSV — DEPRECATED, no longer run)
```

---

## Scheduling status (IMPORTANT)

As of 2026-07-23, only TWO crons are actually scheduled in `vercel.json`:
`idle-report` (`0 22 * * 1-5`) and commissions finalize (`0 6 1 * *`).

**The entire FP chain above is currently MANUAL** despite the "cron" naming — each step
is fired by hand (or by a browser/scheduler hitting the URL). This is why 7/17 did not
auto-run. If/when we automate: either build one orchestrator endpoint that chains 1→10
in order, or add each to `vercel.json` with enough spacing for dependencies to complete.

---

## Scoring models (reference)

- **WP:** closeOut×0.45 + callback×0.30 + driving×0.10 + reliability×0.15
- **PMP:** revEff×0.35 + reservice×0.20 + completion×0.20 + driving×0.10 + reliability×0.15
- **IP:** driving×0.50 + reliability×0.50
- Targets: CO≥0.85, CB≤0.15, revEff≥0.90, reservice≤0.10, completion≥0.95,
  driving≥0.90, reliability≥0.90. Industry weekly prod standard = 5676.923077.
- Production bug fix (baked into `week` endpoint): no-show reservice/wildlife → $0;
  other no-shows → subscription value.
