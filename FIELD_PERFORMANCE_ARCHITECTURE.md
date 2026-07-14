# Field Performance — Architecture Review & Restructuring Plan

## Metric → Source → Storage map

| Metric | Team | Fetches from | Stored in | FR reads/week | Status |
|--------|------|-------------|-----------|--------------|--------|
| Production value | PMP | FR (routes → spots → appts) | `tech_routes` + `TechWeek.productionValue` | heavy (per route) | ✅ restructured |
| Route count (revEff) | PMP | `tech_routes` DB | — | 0 | ✅ restructured |
| Completion % | PMP | `tech_routes` DB (30d) | `TechWeek.completionPct` | 0 | ✅ restructured (new `completion` endpoint) |
| Revenue efficiency | PMP | computed from DB | `TechWeek.revenueEfficiency` | 0 | ✅ formula fixed |
| Reservice rate | PMP | FR (90-day appt window) | `TechWeek.reseviceRate` | **heavy every week** | ⚠️ still re-fetches |
| CO% | WP | `tc_appointments` DB | `TechWeek.closeOutPct` | 0 | ✅ already DB-backed |
| CB rate | WP | `tc_appointments` DB | `TechWeek.callbackRate` | 0 | ✅ already DB-backed |
| TC Accountability | WP | FR (current wk + 90d fwd + 60d) | `tc_appointments` | heavy (source of truth) | ✅ correct as-is |
| Driving | all | Bouncie API | `TechWeek.drivingScore` + raw inputs | 0 FR (Bouncie has no daily cap) | ✅ fine as-is |
| Reliability | all | `tech_route_customers` DB + Bouncie | `tech_day_reliability` + `TechWeek` | 0 FR (Bouncie techs) | ✅ restructured |
| Reliability FR fallback | all | FR (appt times, techs w/o Bouncie) | `tech_day_reliability` | light (few techs) | ⚠️ minor |

## Dead code found
- `cron/field-performance` still contains `pullRouteReporting()` and `pullReservices()` functions (lines 166, 218) that are **no longer called** — the PMP path was removed (lines 314-315, 398). Safe to delete ~120 lines.

## Remaining FR re-fetches (the real weekly load)
1. **Reservice (run endpoint)** — 90-day `appointment/search` + batched `appointment/get` per office, every week. This is the single biggest remaining redundant FR consumer. The attribution logic (match each reservice to the last regular service before it) needs the full customer service history, which is why it can't trivially use `tech_routes` (routes ≠ full appt history).
2. **TC Accountability** — genuinely needs FR every week (captures evolving appointment outcomes). This is the *source of truth* other WP metrics read from. Keep.
3. **Reliability FR fallback** — only for the handful of techs without Bouncie devices. Light. Low priority.

## The reservice question — best approach
Reservice is the one worth restructuring. Options:
- **A (recommended): dedicated `PmpAppointment` snapshot table.** A weekly step stores the current week's completed appts (type, date, customerID, servicedBy). Reservice then reads the trailing 90 days from DB. First run backfills 90 days once; steady state fetches only the new week. Reduces weekly FR load ~90d→7d. Needs careful side-by-side validation because attribution is subtle.
- **B: leave as-is.** It works and is well-tested. Risk of silent errors if moved.

## Recommended weekly pipeline (target state)
1. `week` (per office) → populates `tech_routes` + production
2. `completion` (per office) → completion% from `tech_routes` (replaces thirtyDayA/B)
3. `run` (per office) → revEff + reservice
4. `tc-accountability/run` → populates `tc_appointments`
5. `cron/field-performance` → CO% + CB from `tc_appointments` (WP only now)
6. `routeCustomers` (per office) → `tech_route_customers`
7. `bouncie` → driving
8. `reliability` LAST → reads `tech_route_customers`, writes `tech_day_reliability` + scores

## To retire
- `thirtyDayA` / `thirtyDayB` — replaced by `completion` (once tech_routes has 5 weeks history per office)
