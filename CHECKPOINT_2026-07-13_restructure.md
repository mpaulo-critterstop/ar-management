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

### 8. Idle-event start/end of day — ✅ DONE & VERIFIED (commit d2fe249)
Problem: techs who don't turn engine off at a stop (grab supplies at office/store, or drop supplies
at office before home) — Bouncie sees ONE continuous trip, so trip-end/start logic missed the stop,
marking them late / under-utilized unfairly.
Fix: reliability reads bouncie_trip_events (per-point GPS from webhook — CONFIRMED ACTIVE, 2M+ events,
~858k/week, live). Idle event (speed=0 EXACTLY) within a business/customer geofence pulls start-of-day
EARLIER or pushes end-of-day LATER. Same geofence set; only queries windows that could change the
answer; workday-bounded (~4AM–10PM CST).
VERIFIED 7/10: 315 adjustments across 49 techs; earliest pulled-start 5:40AM (no pre-5:30 false matches).
NOTE: bouncie_trip_events grows ~858k rows/week — add retention/prune policy eventually.
NOTE: only affects Bouncie techs (16 FR-fallback techs unaffected). Backfill weeks need reliability
re-run to get this benefit (deferred).

### 9. Time-at-job (timeAtJobMins) — ✅ FIXED & GAP-FILLED (2026-07-14)
Problem 1 (found via diagnostic): ~13% of tc_appointments had null timeAtJobMins across ALL history
(2023–2026), a persistent miss — the old trip-gap dwell method (reliability cron) has structural blind
spots (engine left running, last stop of day, customer not in tech_route_customers).
Built /api/field-performance/fillTimeAtJob (Option C) to compute dwell from per-point GPS (bouncie_trip_events).
CRITICAL BUG + FIX (found via Luke Painter 198941, user caught it): a parked truck with engine OFF emits
NO Bouncie points. So dwell is NOT a run of speed=0 points — it's the DATA GAP between the arrival point
and the departure point near the customer. First attempt summed speed=0 points → got 0.6min for a ~115min
stop. CORRECT logic: timeAtJob = first-inside-geofence → last-inside-geofence timestamp per visit; a NEW
visit begins only when the truck was seen OUTSIDE the geofence between two inside points (a data gap alone
= tech parked/working, not a departure). Sum visits. Verified: Luke 198941 = 118 min (matches observed ~115).
Def confirmed w/ user: "actual minutes from arrival to departure, per appointment, summed across visits."
DATA STATE: reset all post-2026-06-28 completed timeAtJobMins to null, recomputed with corrected logic —
297 filled. ~89 unfillable (no Bouncie device / no GPS that day / truck never within 500m). Pre-webhook
(<2026-06-28) nulls are PERMANENTLY unfillable (no per-point GPS existed then) — left as-is.
Endpoint batching: ?limit= + ?offset= cursor + ?since= floor (defaults post-webhook) so it advances past
unfillable records. LESSON: bouncie_trip_events queries must be scoped by imei+timestamp (indexed);
global speed filters scan 2M rows and time out.
TODO: fold this GPS-based dwell into the reliability cron to replace the trip-gap method going forward
(so new weeks populate correctly without manual fill). Also debug endpoints /api/debug/timeatjob and
/api/debug/idle-events exist for tracing.

### 10. CSR Leads Tracker overhaul — ✅ DONE (2026-07-14)
Sync: /api/sync/csr-appointments → csr_appointments. Read: /api/leads/csr. Attribution build: /api/leads/csr-backfill.
PROBLEM CHAIN (all resolved): app showed 609, Ana 613, FR 624 — none matched.
- Root cause 1: service-ID list was only 12 IDs, missing 18 (office-specific variants for ATX/OKC/CStat
  + whole categories: DAR-Lead, Insulation Insp, per-office Wildlife). EXPANDED to all 30 IDs (global +
  office-specific) so historical appts under office-specific IDs are captured. User is migrating offices
  to global IDs but kept office-specific in list for history. Full 30-ID list is in sync/csr-appointments.
- Root cause 2: wildlife was double-sourced (Lead table). REMOVED Lead-table wildlife source; wildlife now
  comes from FR appointments (645/1037/722/884) — single source.
- Root cause 3: headline "completed" used attribution points (original+1.0 only), excluding rescheduled
  appts. CHANGED to count DISTINCT completed appointments once (incl rescheduled) = matches FR raw count.
  Per-agent point split (original/rescheduler 0.5/0.5) KEPT in the per-agent table. Removed the two
  "Rescheduled by/from others" KPI tiles from UI.
- After rebuild (wipe csr_appointments + re-sync 3890 + backfill): June = 630 (FR now 630 too w/ 30 IDs).
GHOST IDs / self-healing (KEY WIN): CSRs have multiple FR employee IDs across offices; new ones ("ghost
IDs") kept appearing as NULL csrName. FIX: csr-backfill resolver now auto-looks-up unknown frEmployeeIds
via FR employee/get (NOTE: endpoint is 'employee/get' NOT 'employee' — the latter 404s), caches in
csr_employees, name-matches to existing CSRs to inherit isCsr. NO more manual ID inserts.
isCsr FLAG: added to CsrEmployee (migration run manually: ALTER TABLE add isCsr bool default true).
Non-CSR bookers (Chisam, Warren, Mark Paulo, techs, etc.) are counted in totals but isCsr=false → hidden
from per-agent table. Auto-resolved new bookers default isCsr=false unless name matches existing CSR.
MANAGE CSRs MODAL: rewritten name-based (one row per person, no IDs shown). "Add CSR" takes just a name,
flips isCsr=true for all their IDs (or creates a pending_ placeholder if they haven't booked yet, which
the resolver later replaces with their real ID). Active/inactive toggle + remove kept.
MANUAL DATA FIXES done by user: Luis Cajas 10911 (FR name "Luis Cajas7") set isCsr=true + name normalized;
Rhonda Bearden + Lori Cottle set isCsr=false (non-CSRs); Sharon Heymann left as isCsr=false (departed).
LESSON (user feedback): be concise, pull actual data instead of theorizing, always provide the actual
SQL/query rather than describing it.

### 11. AR multi-property/commercial exclusion (detection only — NOT wired to automation yet)
Goal: when non-wildlife AR invoices are eventually turned on for PestAI, exclude commercial + multi-property
accounts (StyleCraft, Bell Properties) — they have many contacts/PMs/AP depts, so residential-style
follow-up sequences would be noisy/damaging. Only single-billing RESIDENTIAL accounts get automation.
Detection (from FR customer record): commercialAccount, masterAccount, billToAccountID.
Rule: excludeFromAutomation = commercial==1 OR masterAccount set (rolls up to a parent) OR billToAccountID
≠ own ID (bills elsewhere). Added 4 fields to Customer: commercialAccount, masterAccountId, billToAccountId,
excludeFromAutomation (migration run manually).
Detection added to sync/auto (THE real multi-office AR sync — NOT sync/fieldroutes, which was a wrong
first attempt but harmless). ar-followup feed now has `AND c.excludeFromAutomation=false` so excluded
accounts never enter the sequence.
FIX: syncCustomers ignored fullSync (only used dateUpdated incremental) → full sync now passes no fromDate
so it backfills flags across ALL accounts, not just recently-updated.
VERIFIED: StyleCraft 39053 (child, master=39295) + 39295 (master, billTo=39053) both excludeFromAutomation=true.
USER RUNNING full customer sync per office to backfill all accounts (DFW in progress).
CRITICAL PER USER: do NOT turn on non-wildlife automation, and do NOT wire this into the live PestAI
webhook. Detection/flagging only, staged for a careful future rollout. Non-wildlife AR is intentionally
OFF (thousands of due invoices need careful planning first).
Sync trigger (session-authed, run in browser): POST /api/sync/auto {syncType:'customers', fullSync:true[, office:'DFW']}
Scope check query: SELECT office, COUNT(*) FILTER (WHERE "excludeFromAutomation") excluded, COUNT(*) total FROM customers GROUP BY office;

### 12. FR checklist / close-out field readability — INVESTIGATED, not API-readable (no code changes)
Question: can we read the "closed out" field from techs' trap-check checklists (saved in FR customer
card documents tab) instead of relying on the note-keyword method? Concern: not all techs use the
close-out keywords in office/tech notes.
FINDINGS:
- `document/search?includeData=1` (NOT document/get — that ignores the ID param) returns document
  METADATA only: uploadID, customerID, addedBy, description, appointmentID, bucket. These are the
  SmarterLaunch signed PDFs — NOT the checklists.
- Checklists live in the `form` API. `form/search` (ignores customerIDs, returns all formIDs) +
  `form/get?formIDs=` returns checklist instances with: formID, contractID, customerID, employeeID,
  documentState (WIP / completed / signed), formTemplateID, formDescription (e.g. "Annual Inspection
  Checklist", "One Time Service Checklist"). WIP status confirmed — matches user's note that checklists
  are saved but in WIP.
- BUT form/get exposes only METADATA, not the internal field answers. No way to read the actual
  "closed out: yes/no" checkbox. Dead ends: form/getData = "INVALID REQUEST" (not a real action),
  contract/get = count 0 for WIP forms, no formField endpoint.
CONCLUSION: close-out field NOT API-readable. POTENTIAL FUTURE PROXY: `documentState` (WIP vs completed/
signed) could serve as a close-out signal IF finishing the checklist == closing out the customer — more
reliable than keyword-scanning notes. Not pursued now. USER DECISION: leave as-is, will give techs
guidance to use the close-out keywords in notes. No code changed.

### 13. Chisam's FP feature requests — build sequence (agreed)
Order (features before the access gates that filter them): 1) Column sorting ✅ DONE, 2) Team-leader
filter (keystone — builds roster mapping that access-control reuses), 3) Manual-adjustments view + MoM
filters, 4) Commissions table, 5) Access control LAST.
PERMISSIONS MODEL SKETCH (for #5, when built): keep role enum for broad tiers; add per-user `modules
String[]` (allowlist: ar/dispatch/leads/csr/field-performance/dialpad/kpi), `permissions Json?`
({hidePmKpis, ownDataOnly, isTeamLeader}), `frEmployeeId`/`techId` to link login→FR identity for
row-level (PM own-commission, tech own-data). Enforce server-side (inject WHERE filters) AND client-side
(hide nav). Module-level (ar/dispatcher/csr) is light; row-level (pm/tech) reuses team-leader roster
mapping + auto-match-by-email like the CSR resolver.

### 13a. Column sorting (Chisam feature #1) — ✅ DONE
Reusable helpers in field-performance/helpers.tsx: useSort(initialKey,dir) returns {key,dir,set}
(set toggles asc/desc, new col starts desc); sortRows(rows,sort,accessors) (nulls sort last);
SortableTh clickable header w/ ▲▼ arrow. Applied to ALL 6 tabs: DrivingTab (Max Speed/Safety Alerts/
Idle Ratio — Chisam's example), IndividualsTab, AttendanceTab (Punctuality=minutesLate — his other
example), ScoreboardTab, TcAccountabilityTab, TeamsTab (crew+site, independent sorts). Replaced old
sort dropdowns. Commits 2c9413b→09ff176.
NOTE: GitHub token expired mid-session; new one embedded in remote: github_pat_11CENWOHY... (if push
fails, get a fresh token + git remote set-url).

### 13b. Team-leader filter (Chisam feature #2) — ✅ DONE
Page-level "All team leaders" dropdown (field-performance/page.tsx) populated from roster crew+site
leaders. Filters Scoreboard, Individuals, Driving, Attendance, TcAccountability tabs. A tech matches
if crewLeader===leader OR siteLeader===leader. Uses EXISTING Technician.crewLeader/siteLeader fields
(managed in RosterTab) — NO Google Sheet needed (Chisam assumed we would). Surfaced leader fields
through techweek/attendance/tc-accountability APIs (top-level on each row); scoreboard filters
server-side via ?leader=. This roster mapping is what access-control row-level (feature #5) reuses.
Commit f5e1b46. NOT applied to Teams/MoM/Roster tabs (Teams already groups by leader; MoM/Roster N/A).

### 13c. Manual-adjustments view + MoM filters (feature #3) — ✅ DONE
ManualAdjTab: "All weeks" toggle (shows all adjustments across weeks, adds a Week column) + "All team
members" dropdown (filters by techId). manual-adj API gained allWeeks + techId params, leader fields.
MoMTab: added "All team leaders" filter + Active/Inactive/All status filter. MoM API now outputs
siteLeader + status; FIXED latent bug where crewLeader was read from w.crewLeader (undefined) instead
of w.technician.crewLeader — was always null before. Commit 8a70188.

### 13c-2. Monthly filter (added to feature #3 scope) — ✅ DONE
Page-level Week/Month toggle + month/year dropdowns (field-performance/page.tsx). Shared `Period` type
+ `periodParams()` helper in helpers.tsx. Month mode aggregates STORED WEEKLY BUCKETS by the month the
weekEnd falls in (per user: 7/3 → July). Scores averaged, counts summed, ONE row per tech
(Scoreboard/Individuals/Driving/Teams collapse per-tech across the month's weeks). Attendance + TC show
all raw records whose week falls in the month. NOT a raw recompute — weekly TechWeek is the finest
stored grain for scores. All 6 tabs + their APIs (techweek, scoreboard, attendance, tc-accountability,
teams) updated. Commits e62039d→05b5d07.

### 13c-3. Team-leader filter refined — crew leaders only, exclude self-assigned
Dropdown lists crewLeader values only (site leaders removed), and only leaders with ≥1 tech OTHER than
themselves (excludes Kyle Oktay, service manager assigned as crew leader to himself). Auto-updates from
Roster tab. All tab filters match crewLeader only. Commit d5039c7. Confirmed 7 leaders: Adrian Valerio,
Bryan Bovee, Cynthia Barrientos, Jacob Fenton, Mat Hughes, Megan Delph, Warren Loignon.

### 13d. NEXT: Commissions table (feature #4), then Access control (#5)

### 13c-4. MoM — all 8 per-metric tables (matches FPEM MoM sheet) — ✅ DONE
The FPEM MoM sheet has 8 stacked per-metric tables; Hub previously showed only Total score. Added a
metric selector to MoMTab with all 8: Total Effort (0.90 std), +1 Wk CO% (0.85), 60 Day CB Rate (0.15,
LOWER better), Pest Revenue Eff (0.90), Reservice Rate (0.10, LOWER better), Completion % (0.95),
Driving Effort (0.90), Reliability Score (0.90). Each shows metric month-by-month per tech (YTD + Jan-Dec),
sorted best-first (direction respects higher/lower-is-better), with a Total Team avg row + the standard.
MoM API aggregates all 8 from TechWeek + pooled team averages. VERIFIED vs Excel: YTD = avg of WEEKLY
values (NOT avg-of-months — confirmed Adrian 1.0233 ≠ 1.0098 month-avg). CB/reservice color-flip.
Commit a95b5ad. Also hid the page-level Week/Month period selector on the MoM tab (it's inherently
monthly w/ its own year dropdown — the selector was disconnected, looked broken). Commit e33cc1a.

### 13c-5. Adjustments tab — always show all in one page — ✅ DONE (per Chisam)
Removed the This-week/All-weeks toggle; Adjustments now always lists every adjustment across all weeks,
Week column always visible, team-member filter retained. Page-level period selector hidden on this tab
too. Add-adjustment form still attaches to current week, labeled "Week of X". Commit f5d524f.

### 13c-6. Manual adjustment UNITS BUG — ✅ FIXED (important)
Adjustments are entered in POINTS (1 pt = 1% = 0.01 of the 0-1.1 decimal score). USER CONFIRMED: type
"10" for +10%, "-20" for -20%. Two problems found+fixed:
(1) CODE: 8 of 10 code paths added manualAdj RAW to the decimal totalScore (so 10 pts → +1000%). Fixed
manual-adj POST/DELETE, techweek recompute, driving-override, reliability cron (5 spots), bouncie cron
(3 spots) — all now divide by 100. run + field-performance crons were already correct. Commit 3868ec1.
(2) DATA: mixed units in DB. `manual_adjs` table: 12 "spreadsheet" rows were points (-20..+8), 7 "admin@"
rows were decimals (-0.1..+0.05). `tech_weeks.manualAdj` column had ALL rows as decimals but totalScore
was CORRECT (decimal manualAdj added to decimal base gave right total). Fix ran via Supabase SQL:
  - `UPDATE manual_adjs SET totalPoints=*100, leadershipPts=*100, frPts=*100, reviewsPts=*100 WHERE ABS(totalPoints)<1 AND totalPoints!=0;` (converted 7 decimal rows to points)
  - `UPDATE tech_weeks SET manualAdj=manualAdj*100 WHERE manualAdj IS NOT NULL AND manualAdj!=0;` (aligned column to points; totalScore UNCHANGED so scores stayed correct AND future cron recompute base+points/100 reproduces same total)
VERIFIED: tech_weeks.manualAdj == manual_adjs.totalPoints on every row; scores unchanged. Units now
consistent end-to-end: entry → manual_adjs → tech_weeks.manualAdj → score calc, all points, /100 at final step.

### 13d. REMAINING: Commissions table (feature #4) + Access control (feature #5)
Features 1-3 (+ monthly filter, 8 MoM metrics, adjustments-all, units fix) DONE. Two features left.

#### #4 COMMISSIONS TABLE — ANALYZED, ready to design (nothing built yet)
Source analyzed: user's sales-commission Excel (FULL history file `Untitled_spreadsheet__1_.xlsx`,
Nov 2023–Jun 2026, 32 month-cols J–AO; the first smaller file was last-3-months w/ formulas stripped —
use the FULL one). One sheet "Sales Commission", 14 stacked per-PM blocks (~20-40 rows each, cols =
months). WARNING: block boundaries shift as PMs are added — MUST re-scan title rows ('X Commission
Tracker'), don't assume row offsets (Claude mis-mapped Travis by ~100 rows on first pass; user caught it).

SHARED BACKBONE (all PMs): Booked Revenue (pasted from upstream) → Cumulative Pre-Period Delta →
Other Adjustments → Total Adjustments → Adjusted Booked Revenue (ABR) → Wildlife Comm + Pest Control
Comm = Total Monthly Commission.
  - Cumulative Pre-Period = ThisCumulativeBooked − ThisMonthBooked; Pre-Period Delta = ThisCumPrePeriod
    − LastMonthCumBooked. Captures prior-month restatements (this IS Chisam's "dynamic reconciliation").

TWO WILDLIFE-COMMISSION METHODS + variants:
  - METHOD 1 "ABR-tiered" (Jordan, Jared-New, Brant, Warren, Travis): marginal tiers on ABR w/ $80k floor:
    $0-80k=0%, $80-140k=8%, $140-180k=10%, >$180k=12%.
    Formula: =max((min(ABR,140000)-80000)*0.08,0)+max((min(ABR,180000)-140000)*0.1,0)+if(ABR>180000,(ABR-180000)*0.12,0)
  - METHOD 1 VARIANT (Adrian): =min(10000,base)*0.05+max(0,(base-10000)*0.07). (Roderick's sheet calls
    this "Alternative Method (Adrian)".)
  - METHOD 2 "lead-bucket" (Blake, Han Bien-B, Cynthia active): needs #ofLeads + BookedRev/Lead; marginal
    buckets ×#leads: $700-1000/lead=8%, $1000-1200=10%, $1200-1400=12%, >$1400=14%.
    Per bucket: =max(0,(min(revPerLead,CAP)-FLOOR)*#leads*RATE); wildlife = sum of 4 buckets.
    (Adrian's inactive bucket block uses 6/8/10/12% — lower rates — but Adrian is ACTIVE on Method-1-variant.)
PER-PM MODIFIERS: NOTE both "one-off" cases are OTHER ADJUSTMENTS, not plan modifiers: Travis -$4,000
(salary-advance repayment), Blake +336 (a pest-control commission owed that wasn't paid separately).

CALCULATION FLOW (Hub — DIFFERS from spreadsheet on where Other Adjustments applies):
  Booked Revenue (LIVE from Leads Tracker PM-KPIs, keyed by invoice date — NOT a manual paste)
    + Pre-Period Delta            [revenue-level reconciliation, applied to REVENUE]
    = Adjusted Booked Revenue
    → Wildlife Commission          [per-PM method on ABR: abr_tiered / abr_adrian / lead_bucket]
    + Pest Control Commission      [MANUAL input for now, blank/0 default]
    = Calculated Commission
    + Other Adjustments            [final-DOLLAR one-offs: Travis -4000, Blake pest fix — applied to
                                    the COMMISSION TOTAL, dollar-for-dollar, NOT to revenue]
    = Total Commission Paid
  IMPORTANT: On the SPREADSHEET, Other Adjustments fed into Adjusted Booked Revenue (pre-commission, so
  it got multiplied by the comm rate). In the HUB, per user: Other Adjustments applies to the FINAL
  commission dollar amount (post-calculation). Pre-Period Delta STILL applies to revenue (it genuinely
  restates booked revenue the commission should be computed on).
  DELTA DIRECTION (confirmed): negative delta = prior-month revenue dropped (cancellation/discount after
  pay) = reduce this month to claw back overpayment; positive = prior revenue grew = pay the shortfall.
  AS-PAID SNAPSHOT: Hub must store, per PM per month, the booked-revenue figure commission was actually
  PAID on. Each month, compare live booked rev for prior months vs their as-paid snapshot → difference
  = pre-period delta for current month. This automates what the spreadsheet did by hardcoding month-end.
TIME-VERSIONED PLANS: Jared (New/Old), Han Bien (two blocks) = plans changed over time → model needs
effective-dated plans. Empty/inactive blocks: Jared-Old, Kenny, Jacob, Roderick, Han Bien-A (departed
PMs or retired plans — historical only).

USER DECISIONS SO FAR:
  - PLACEMENT: new Commissions tab in the LEADS TRACKER module (src/app/leads), next to KPIs + CSR Leads
    Tracker tabs. Same module because booked-revenue source is the leads data / PM-KPIs table.
  - SYNC = PIGGYBACK on the existing Leads Tracker sync button. That sync already refreshes the KPIs
    running booked revenue (the exact commission source), so it also recomputes commissions → PMs see
    LIVE running numbers ("where I currently stand"). No separate refresh action.
  - FINALIZE TRIGGER: automatic cron, 1st of month 12:00am US CENTRAL, snapshots the JUST-ENDED month's
    booked revenue per PM as the as-paid figure (baseline for future pre-period deltas). Add a safety-net
    fallback: if a sync detects a prior month closed with no snapshot, finalize it then (missed-cron guard,
    since this is pay).
  - FINALIZED INDICATOR: small marker on the month COLUMN showing it's finalized/locked, so PMs can tell
    locked history from the live in-progress current month.
  - Points-style entry N/A here; commissions are $.
  - SNAPSHOT TRIGGER: display always recalcs live (booked rev live + delta vs snapshots), so cron-vs-manual
    only affects WHEN the as-paid snapshot freezes — decided later, does NOT block build. (Options: monthly
    cron 12am 1st US-Central snapshotting the just-ended month, OR manual "Close Month" button. Recommend
    manual to start while validating vs old spreadsheet, automate later.)
  - PEST CONTROL COMMISSION + OTHER ADJUSTMENTS: both EDITABLE per PM per month (hand-entered inputs).
    Pest comm = manual until future Pest Control Sales module. Other adjustments = final-dollar one-offs.
  - PEST CONTROL COMMISSION: leave BLANK/manual for now — user calculates separately by hand until a
    future "Pest Control Sales module" is built. Hub computes WILDLIFE + backbone only; pest comm is an
    editable input defaulting blank/0.
  - Per-PM privacy: each PM sees ONLY their own commission (confirmed earlier w/ Chisam).
STILL TO CONFIRM before/during build: Blake's +336; whether Booked Revenue is a monthly INPUT (hybrid,
matches current process — RECOMMENDED) or pulled from FR (full-auto, harder). Recommended model:
CommissionPlan per PM {method: abr_tiered|abr_adrian|lead_bucket, tier params, flatModifier, effective
dates}; shared backbone computed for all; booked rev + pest comm as inputs.

#### #5 Access control — LAST
Module-level tier (ar@/dispatcher@/csr@ logins) UNBLOCKED, can build anytime. Row-level tier (PM
own-commission, tech own-data) depends on commission table + reuses team-leader roster mapping.
Permissions model sketch earlier in this file (section 13/13d region).

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
