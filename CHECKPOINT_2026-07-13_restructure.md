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

### 1. DFW backfill — ✅ DONE (completed 2026-07-14, after FR daily reset)
CStat: fully backfilled. DFW: fully backfilled (all 5 weeks 6/12–7/10 + 90-day pmp_appointments,
10,773 completed appts in window). ATX/OKC: NO PMP techs (confirmed, nothing to backfill).
LESSON: week endpoint's concurrent-10 processing can burst past FR's 60-reads/min limit → mid-run
502 + partial save (7/3 first saved 28/60 routes, then a clean re-run finished it — idempotent by
frRouteId). Do NOT infer success from FR read-count deltas; a partial 502 still consumes reads.
Always confirm status:success + full route count. Future improvement: throttle week concurrency or
add retry-on-502.

### 2. Validation — NOT YET DONE (user wants to do this after all backfill)
Nothing has been compared against ground truth (FR UI / original spreadsheet). What's proven so far:
- completion: counting logic is line-for-line identical to old thirtyDay; window math correct. NOT output-compared.
- reservice: INPUT parity proven (FR returned 2095 IDs for CStat 90-day = 2095 fetched, 2006 completed stored).
  Logic is a direct port. NOT output-compared (old code no longer exists to run side-by-side).
- **revEff: ✅ RESOLVED & VALIDATED (2026-07-14, commit 0019e41).** Correct formula confirmed by user
  against spreadsheet + hand-calc on Jacob Kidd:
  ```
  productiveDays = count of tech's routes this week with productionValue > 0  (days assigned to
                   other work are NOT counted against the tech)
  hrsPerDay      = tech.hrDays  (8 for 5-day×8hr schedule, 10 for 4-day×10hr schedule)
  assumedWeekly  = actualProduction / (productiveDays × hrsPerDay) × 40   ← normalize to full 40hr week
  revEff         = min(assumedWeekly / 5676.923077, 1.1)                  ← ÷ industry avg WEEKLY prod
  ```
  Denominator is 5676.92 (industry avg WEEKLY production, spreadsheet Col Q) — NOT the old per-day 1150.
  Old formula `production/(stdDays×1150)` was WRONG on two counts: wrong constant, and it penalized $0 days.
  VERIFIED: Jacob Kidd 7/10 = $1737.40 over 2 productive days (8hr) → assumedWeekly $4343.50 → revEff 77%.
  Live-confirmed both offices. Note: techs with 0 productive days (e.g. Warren) → revEff null (correct).
- **Validation method:** pick ONE tech, compare their completion% / reservice / revEff from our DB
  against what FR (or the old Field_Professional_Effort_Meter spreadsheet) shows for the SAME week.
  If all three match for one tech, the chain is validated.

### 3. Cleanup + hardening — ✅ DONE (2026-07-14, commit 0ca98df)
- Deleted dead `pullRouteReporting()` + `pullReservices()` from cron/field-performance (~90 lines).
- Added retry-with-exponential-backoff (2s/4s/8s, 3 retries) for transient FR 502/503/504/429/timeout
  in BOTH week endpoint's rate limiter AND pmpAppointments' frFetch.
- Lowered week CONCURRENCY 10→5 (each route = 3-5 FR calls; 10-wide bursts blew past FR 60/min → 502s).
- Fixed silent batch-skip in pmpAppointments fetchInBatches: now counts + surfaces failedBatches,
  returns status:'partial' if any batch fails so incomplete backfills are detectable (not silent).
- VERIFIED DFW pmp_appointments complete: 10,164 fetched, 9,984 stored, 0 failed batches.

### 4. Retire once DFW backfill confirms
- `thirtyDayA` / `thirtyDayB` endpoints — superseded by `completion`.

---

### 5. No-show production exclusion — ✅ CODE DONE (commit 0899141), DATA PARTIALLY RE-RUN
Business decision (confirmed w/ leadership): no-show/not-serviced appts contribute $0 production.
Old code added recurring charge or ticket amt for no-shows (to match FR booked-revenue); now excluded.
No-shows still counted in noShow tally (completion rate unaffected). Fix is in week/getRouteStats only.
VERIFIED: Trevis route 57021 had 4 no-shows worth $335 recurring (now excluded); Jacob Kidd Fri route
$917.20→$517.20 ($400 no-show excluded).
IMPACT: Jacob Kidd revEff 77%→59% (prod $1737.40→$1337.40). Earlier "validated 77%" used no-show-inflated
production; 59% is correct per the rule.
DATA STATE: 7/10 ✅ re-run BOTH DFW+CStat. Backfill weeks 6/12,6/19,6/26,7/3 ❌ still carry old
no-show-inflated production — deferred to save FR budget. Re-run later (idempotent, ~1000+ reads for DFW).

### 6. Geocoding gap — ✅ CLEARED
Found 335 ungeocoded customers (new customers piling up — geocode NOT in weekly pipeline). User cleared
via app buttons: Addresses (sync-addresses) THEN Geocode. Now 3 left, all dummy accounts — ignore.
Schema: address = `serviceAddr` (single string), coords lat/lng, geocodedAt, status.
FOLLOW-ON: ungeocoded customers had been SILENTLY DROPPED from reliability geofencing (routeCustomers
only saves customers WITH coords; reliability's start-of-day = first trip end within 300m of a known
stop — an ungeocoded stop can't match, understating that tech's day). After clearing geocodes, re-ran
routeCustomers (ALL offices, now 100% geocoded — e.g. DFW offset60 jumped 71→139 customers) THEN
reliability for 7/10: loaded 162 tech-day / 975 customers (was 124/722), 49 techs updated. 7/10 reliability
now correct. CAVEAT: backfill weeks 6/12–7/3 reliability still computed w/ old ungeocoded data — re-run
routeCustomers→reliability for those weeks later to correct. FR-fallback techs (16 w/o Bouncie) unaffected.

### 7. PIPELINE IS FULLY MANUAL — no weekly cron (discovered 2026-07-14)
vercel.json crons has ONLY idle-report. Entire field-performance pipeline is triggered MANUALLY.
USER DECISION: keep manual for now (still debugging, avoid auto-consuming FR limits). Wire crons LATER
once formulas finalized. When doing so: geocode + sync-addresses BEFORE routeCustomers; reliability LAST;
pace for FR 5000/day + 60/min.

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
