# CHECKPOINT — Field Performance DB Restructuring
**Date:** 2026-07-13 (Session 30)
**Repo:** github.com/mpaulo-critterstop/ar-management
**Latest commit at checkpoint:** `6a81630`
**Vercel bypass:** `bf60476816e8a9cc5a65070dfff55adc` | **CRON_SECRET / token:** `critterstop2026`

> How to use this file: A future session can be pointed here with "review the checkpoint at
> /mnt/user-data/uploads (or repo root) CHECKPOINT_2026-07-13_restructure.md". It captures the
> GOAL, what's DONE, what's PENDING, and how to VALIDATE. Read the referenced source files for detail.

---

## THE GOAL OF THIS RESTRUCTURING
Stop re-fetching the same data from FieldRoutes (FR) every week. FR has a **5,000 reads/day** and
**60 reads/min** limit per office key, and the weekly pipeline was blowing through it by re-pulling
routes, appointments, and a 90-day reservice window every run. Move everything to permanent DB tables
so weekly runs only fetch the *new* week and read history from Postgres.

---

## NEW DB TABLES ADDED THIS SESSION (all live in Supabase)
1. **`tech_routes`** — one row per tech per route/day (completed/pending/noShow/productionValue).
   Written by `week` endpoint. Unique key: (techId, frRouteId).
2. **`tech_route_customers`** — customer lat/lng per tech per day, for reliability geofencing.
   Written by `routeCustomers`. Replaced the old AppSetting `rc_customers_*` JSON blobs.
3. **`tech_day_reliability`** — per-day reliability (minutesLate, utilization, hrs, start/end of day).
   Written by `reliability` cron. Unique key: (techId, date).
4. **`pmp_appointments`** — rolling 90-day window of completed PMP appointments (type, date,
   customerId, frEmployeeId, isReservice). Written by NEW `pmpAppointments` endpoint. For reservice attribution.

The SQL for all four has been run in Supabase already (user confirmed "no rows returned" = success).

---

## WHAT'S DONE (committed + deployed)
- **`week` endpoint** (`0c2eec3`, `08ef8e9`): saves per-route rows to `tech_routes` + production to TechWeek.
- **`completion` endpoint** (NEW, `a5c41f3`): computes 30-day completion% by summing `tech_routes`
  over trailing 30 days. **Replaces the slow thirtyDayA + thirtyDayB FR-refetch pair.**
- **`routeCustomers`** (`08ef8e9`): writes to `tech_route_customers` instead of AppSetting blobs.
- **`reliability` cron** (`08ef8e9`): reads `tech_route_customers`; writes `tech_day_reliability` per-day.
- **`run` endpoint** (`08ef8e9`, `8b89d75`): now **100% FR-free** — routeCount from `tech_routes`,
  reservices from `pmp_appointments`. revEff formula = `production / (stdDays × 1150)`, stdDays = 4 if hrDays==10 else 5.
- **`pmpAppointments` endpoint** (NEW, `8b89d75`, `6a81630`): populates `pmp_appointments`.
  `&backfill=true` seeds full 90 days; normal run fetches current week + prunes >100 days.
  (Bug fixed in `6a81630`: parser was grabbing empty `ignoredParams` instead of `appointments` array.)

### Metric → source after restructure
| Metric | Team | Now reads from | FR calls/week |
|--------|------|----------------|---------------|
| Production, route count, completion%, revEff | PMP | tech_routes (DB) | 0 (in run/completion) |
| Reservice rate | PMP | pmp_appointments (DB) | 0 (in run) |
| CO% / CB rate | WP | tc_appointments (DB) — was already DB-backed | 0 |
| Reliability | all | tech_route_customers + Bouncie | 0 FR (Bouncie techs) |
| **TC Accountability** | WP | FR → writes tc_appointments | heavy — CORRECT, it's source of truth |
| Driving | all | Bouncie API | 0 FR (Bouncie has no daily cap) |

Only `week`, `routeCustomers`, `pmpAppointments` (new-week fetch), `tc-accountability`, and the
reliability FR-fallback still touch FR — each fetches only the current week, not history.

---

## WHAT'S PENDING

### 1. DFW backfill (BLOCKED on FR daily limit — resets midnight CST)
CStat is FULLY backfilled (5 weeks of routes + 90-day appts). ATX/OKC have NO PMP techs (confirmed).
DFW is the only remaining PMP backfill. After the primary DFW key resets, run:
```
# 4 prior weeks (7/10 already done):
https://hub.critterstop.com/api/field-performance/week?token=critterstop2026&office=DFW&weekEnd=2026-06-12
https://hub.critterstop.com/api/field-performance/week?token=critterstop2026&office=DFW&weekEnd=2026-06-19
https://hub.critterstop.com/api/field-performance/week?token=critterstop2026&office=DFW&weekEnd=2026-06-26
https://hub.critterstop.com/api/field-performance/week?token=critterstop2026&office=DFW&weekEnd=2026-07-03
# 90-day appointment window (one call):
https://hub.critterstop.com/api/field-performance/pmpAppointments?token=critterstop2026&office=DFW&weekEnd=2026-07-10&backfill=true
```
Estimated cost: ~950–1,250 FR reads. Fits in a fresh 5,000/day. All steps idempotent (safe to re-run).
NOTE: run from browser — these exceed the assistant's shell timeout but finish on Vercel (maxDuration 300).
NOTE: space calls out to avoid the 60/min limit; on a 502/timeout just re-run that URL.

### 2. Validation — NOT YET DONE (user wants to do this after all backfill)
Nothing has been compared against ground truth (FR UI / original spreadsheet). What's proven so far:
- completion: counting logic is line-for-line identical to old thirtyDay; window math correct. NOT output-compared.
- reservice: INPUT parity proven (FR returned 2095 IDs for CStat 90-day = 2095 fetched, 2006 completed stored).
  Logic is a direct port. NOT output-compared (old code no longer exists to run side-by-side).
- **revEff: OPEN CONCERN.** Numbers came out low for several techs (7/10: Trevis 59%, Blake 55%,
  Jacob Kidd 30%, Cynthia 27%). Unresolved whether that's correct or whether productionValue in DB
  mismatches the spreadsheet source. PLAN: recalculate formula later + compare to actual FR numbers manually.
- **Validation method:** pick ONE tech, compare their completion% / reservice / revEff from our DB
  against what FR (or the old Field_Professional_Effort_Meter spreadsheet) shows for the SAME week.
  If all three match for one tech, the chain is validated.

### 3. Cleanup (low priority, zero-risk)
- `cron/field-performance` still contains DEAD functions `pullRouteReporting()` and `pullReservices()`
  (~120 lines, no longer called — PMP path was removed). Safe to delete.

### 4. Retire once DFW backfill confirms
- `thirtyDayA` / `thirtyDayB` endpoints — superseded by `completion`.

---

## TARGET WEEKLY PIPELINE ORDER (after restructure)
1. `week` (per office) → tech_routes + production
2. `pmpAppointments` (per office, new-week mode) → pmp_appointments
3. `completion` (per office) → completion% from tech_routes
4. `run` (per office) → revEff + reservice (FR-free)
5. `tc-accountability/run` → tc_appointments
6. `cron/field-performance` → CO% + CB (WP only)
7. `routeCustomers` (per office, DFW in chunks) → tech_route_customers
8. `bouncie` → driving
9. `reliability` LAST → reads tech_route_customers, writes tech_day_reliability + scores

---

## FR API KEYS
- DFW (officeID=1): key=6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml
  token=uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb  [PRIMARY, 5000/day]
- DFW SPARE (officeID=1): key=bptuip8hitvb0l8f1p1net4k5j0s69nhc7fao7rhpdn2fgmqng1vbgvc75athbpd
  token=l460smgembkt53r0h6jkhbpd32ctapkmtui1j7k7ap16r90rgb9jqg59abckhrhg  [SPARE, only 1000/day]
- ATX (officeID=5): key=tf3d05a4f0rh4nlqs6rqkurjrvm2l7h7gsv0n4bc12uecibp6hjhd897d41pm1a9
  token=1hu3l8lei5ibv5hv48o8a8d5mldh67gdiorolpkjldodm5de1ehkkvi7h6upsqhe
- OKC (officeID=3): key=0tg1jkgtbio4cthib607msc7cqifecjgjjh0jke1h73l8e34b94tguuno7b1stqf
  token=o9mshmsqhv3f10s41qr1t6r56n1o8m2v7jtdlfu2jrpnipebs2fvugtb9omf6i1r
- CStat (officeID=4): key=v26mmb5lm48qnvciq271v189bseepdj3iechgt4tjjta75ee09lrjo4laou0d15l
  token=q7b1tv49r3emq3mibkg43j71vt0qd60fgrjesjmqa3nnqe3brog3uadlvo03j3mj

Note: `week`/`pmpAppointments` read the DFW key from env var FIELDROUTES_KEY_DFW — to drive backfill
off the SPARE key without touching Vercel config, an optional `?key=&token=` override param would need
to be added to those endpoints (discussed, NOT yet built).

## RELATED DOCS
- `FIELD_PERFORMANCE_ARCHITECTURE.md` — full endpoint-by-endpoint review (metric→source→storage map).
