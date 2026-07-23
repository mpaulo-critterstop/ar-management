'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSort, sortRows, SortableTh } from './helpers';

interface RouteRow {
  date: string;
  frRouteId: string;
  productionValue: number;
  completed: number;
  pending: number;
  noShow: number;
}
interface TechRoutes {
  techId: string;
  name: string;
  team: string;
  office: string;
  crewLeader: string | null;
  siteLeader: string | null;
  routes: RouteRow[];
  routeCount: number;
  totalProduction: number;
  productiveDays: number;
  totalCompleted: number;
  totalPending: number;
  totalNoShow: number;
  completionPct: number | null;
  revEff: number | null;
}

const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '0.5px solid #F1EFE8', fontSize: 12, color: '#2C2C2A', whiteSpace: 'nowrap' };
const tdSub: React.CSSProperties = { padding: '6px 12px', borderBottom: '0.5px solid #F1EFE8', fontSize: 11, color: '#5F5E5A', whiteSpace: 'nowrap' };

const money = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (v: number | null) => v === null || v === undefined ? '—' : (v * 100).toFixed(0) + '%';

function pctColor(v: number | null, good: number) {
  if (v === null || v === undefined) return '#b0aea6';
  return v >= good ? '#0A5C2A' : v >= good - 0.1 ? '#7A4500' : '#7A1A1A';
}

interface Props {
  weekEnd: Date;
  office: string;
  leaderFilter?: string;
}

export function RoutesTab({ weekEnd, office, leaderFilter = '' }: Props) {
  const [data, setData] = useState<TechRoutes[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sort = useSort('totalProduction', 'desc');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const officeParam = office === 'All' ? 'ALL' : office;
      const params = new URLSearchParams({ weekEnd: weekEnd.toLocaleDateString('en-CA'), office: officeParam });
      if (leaderFilter) params.set('leader', leaderFilter);
      const res = await fetch(`/api/field-performance/routes?${params.toString()}`);
      const d = await res.json();
      setData(d.techs || []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [weekEnd, office, leaderFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const sorted = sortRows(data, sort, {
    name: r => r.name,
    team: r => r.team,
    routeCount: r => r.routeCount,
    totalProduction: r => r.totalProduction,
    completionPct: r => r.completionPct ?? -1,
    revEff: r => r.revEff ?? -1,
  });

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888780' }}>Loading routes…</div>;

  if (data.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888780', fontSize: 13 }}>
        No route data for this week. Routes are populated from the FieldRoutes route export — if this week hasn't been imported yet, it'll be empty.
      </div>
    );
  }

  // Totals row
  const totalProd = data.reduce((s, t) => s + t.totalProduction, 0);
  const totalRoutes = data.reduce((s, t) => s + t.routeCount, 0);

  return (
    <div style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #E8E7E3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#2C2C2A' }}>PC Routes · {data.length} techs · {totalRoutes} routes · {money(totalProd)} production</div>
        <div style={{ fontSize: 11, color: '#888780' }}>Tap a tech for per-route detail</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8F7F4' }}>
              <SortableTh sortKey="name" sort={sort}>Technician</SortableTh>
              <SortableTh sortKey="team" sort={sort}>Team</SortableTh>
              <SortableTh sortKey="routeCount" sort={sort} align="right">Routes</SortableTh>
              <SortableTh sortKey="totalProduction" sort={sort} align="right">Production</SortableTh>
              <SortableTh sortKey="completionPct" sort={sort} align="right">Completion</SortableTh>
              <SortableTh sortKey="revEff" sort={sort} align="right">Rev Eff</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => {
              const isOpen = expanded === t.techId;
              return (
                <>
                  <tr key={t.techId} onClick={() => setExpanded(isOpen ? null : t.techId)} style={{ cursor: 'pointer', background: isOpen ? '#F1EFE8' : '#fff' }}>
                    <td style={{ ...td, fontWeight: 500 }}>
                      <span style={{ color: '#888780', marginRight: 6, fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
                      {t.name}
                    </td>
                    <td style={td}>{t.team}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{t.routeCount}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{money(t.totalProduction)}</td>
                    <td style={{ ...td, textAlign: 'right', color: pctColor(t.completionPct, 0.95), fontWeight: 500 }}>{pct(t.completionPct)}</td>
                    <td style={{ ...td, textAlign: 'right', color: pctColor(t.revEff, 0.90), fontWeight: 500 }}>{pct(t.revEff)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={t.techId + '-detail'}>
                      <td colSpan={6} style={{ padding: 0, background: '#FAFAF8' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'left', paddingLeft: 32 }}>Date</th>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'left' }}>Route ID</th>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'right' }}>Production</th>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'right' }}>Completed</th>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'right' }}>Pending</th>
                              <th style={{ ...tdSub, fontWeight: 600, textAlign: 'right' }}>No-show</th>
                            </tr>
                          </thead>
                          <tbody>
                            {t.routes.map((r, i) => (
                              <tr key={i}>
                                <td style={{ ...tdSub, paddingLeft: 32 }}>{new Date(r.date).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })}</td>
                                <td style={tdSub}>{r.frRouteId}</td>
                                <td style={{ ...tdSub, textAlign: 'right' }}>{money(r.productionValue)}</td>
                                <td style={{ ...tdSub, textAlign: 'right' }}>{r.completed}</td>
                                <td style={{ ...tdSub, textAlign: 'right' }}>{r.pending}</td>
                                <td style={{ ...tdSub, textAlign: 'right' }}>{r.noShow}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
