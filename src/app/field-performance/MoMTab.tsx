'use client';
import { useEffect, useState } from 'react';
import { teamPill, scoreBadge, card, th, td } from './helpers';

interface Props { office: string; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function MoMTab({ office }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);
  const [teamFilter, setTeamFilter] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState('totalScore');
  // Sub-view toggle: MoM scores vs Bonuses
  const [view, setView] = useState<'scores' | 'bonuses'>('scores');
  const [bonusData, setBonusData] = useState<any>(null);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [showAddBonus, setShowAddBonus] = useState(false);

  const loadBonuses = () => {
    setBonusLoading(true);
    fetch(`/api/field-performance/bonuses?year=${year}&office=${office}`)
      .then(r => r.json())
      .then(d => { setBonusData(d); setBonusLoading(false); })
      .catch(() => setBonusLoading(false));
  };
  useEffect(() => {
    if (view === 'bonuses') loadBonuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, year, office]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/field-performance/mom?year=${year}&office=${office}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year, office]);

  const techs = data?.techs || [];
  const metricDefs = data?.metrics || [];
  const teamAverages = data?.teamAverages || {};
  const activeMetric = metricDefs.find((m: any) => m.key === metric) || metricDefs[0];
  const higher = activeMetric?.higher ?? true;
  const standard = activeMetric?.standard ?? 0.9;

  // Crew leaders present in the data (excluding self-assignments), for the dropdown.
  const leaders = [...new Set(techs.filter((t: any) => t.crewLeader && t.crewLeader !== t.name).map((t: any) => t.crewLeader) as string[])].sort((a, b) => a.localeCompare(b));

  const mData = (t: any) => t.metrics?.[metric] ?? { ytd: null, monthly: {} };

  const filtered = techs.filter((t: any) => {
    const q = search.toLowerCase();
    const nameMatch = t.name?.toLowerCase().includes(q);
    const idMatch = t.techId?.toLowerCase().includes(q);
    const teamMatch = !teamFilter || t.team === teamFilter;
    const leaderMatch = !leaderFilter || t.crewLeader === leaderFilter;
    const statusMatch = statusFilter === 'ALL'
      || (statusFilter === 'ACTIVE' && t.status === 'ACTIVE')
      || (statusFilter === 'INACTIVE' && t.status !== 'ACTIVE');
    return (!search || nameMatch || idMatch) && teamMatch && leaderMatch && statusMatch;
  }).sort((a: any, b: any) => {
    // Sort by the selected metric's YTD, best-first (direction depends on higher-is-better).
    const av = mData(a).ytd, bv = mData(b).ytd;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return higher ? bv - av : av - bv;
  });

  // Color a cell relative to the metric's standard and direction (lower-is-better flips it).
  function scoreCell(val: number | null, key?: string | number) {
    if (val === null || val === undefined) return <td key={key} style={{ ...td, textAlign: 'center', color: '#e2e8f0', fontSize: 11 }}>—</td>;
    const meetsStd = higher ? val >= standard : val <= standard;
    const near = higher ? val >= standard * 0.85 : val <= standard * 1.30;
    const bg = meetsStd ? '#EAF3DE' : near ? '#FAEEDA' : '#FCEBEB';
    const color = meetsStd ? '#27500A' : near ? '#633806' : '#791F1F';
    return <td key={key} style={{ ...td, textAlign: 'center', background: bg, color, fontSize: 11, fontWeight: 500, padding: '6px 4px' }}>{(val * 100).toFixed(1) + '%'}</td>;
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0',
    borderRadius: 8, background: '#fff', color: '#0f172a'
  };

  const teamAvg = teamAverages[metric] ?? { ytd: null, monthly: {} };

  // Crew-leader rollup: group the filtered techs by crewLeader; each month value is the
  // average of that crew's techs for that month (matches the FPEM MoM summary section).
  const leaderRollup = (() => {
    const groups = new Map<string, any[]>();
    for (const t of filtered) {
      const cl = t.crewLeader || '—';
      if (!groups.has(cl)) groups.set(cl, []);
      groups.get(cl)!.push(t);
    }
    const avg = (nums: number[]) => nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    const rows = [...groups.entries()].map(([leader, members]) => {
      const monthly: Record<number, number | null> = {};
      for (let m = 1; m <= 12; m++) {
        const vals = members.map(t => mData(t).monthly?.[m]).filter((v: any) => v !== null && v !== undefined) as number[];
        monthly[m] = avg(vals);
      }
      const ytdVals = members.map(t => mData(t).ytd).filter((v: any) => v !== null && v !== undefined) as number[];
      const offices = [...new Set(members.map(t => t.office))];
      return { leader, memberCount: members.length, office: offices.length === 1 ? offices[0] : 'Multi', ytd: avg(ytdVals), monthly };
    });
    // Sort best-first by YTD (respecting metric direction).
    rows.sort((a, b) => {
      if (a.ytd === null) return 1;
      if (b.ytd === null) return -1;
      return higher ? b.ytd - a.ytd : a.ytd - b.ytd;
    });
    return rows;
  })();

  return (
    <div>
      {/* View toggle: MoM scores ↔ Bonuses */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['scores', 'bonuses'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{
              fontSize: 13, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 500,
              border: view === v ? '1px solid #0052cc' : '0.5px solid #D3D1C7',
              background: view === v ? '#0052cc' : '#fff',
              color: view === v ? '#fff' : '#2C2C2A',
            }}>
            {v === 'scores' ? 'MoM Scores' : 'Bonuses'}
          </button>
        ))}
      </div>

      {view === 'bonuses' ? (
        <BonusesView
          bonusData={bonusData} bonusLoading={bonusLoading} year={year} setYear={setYear}
          onAdd={() => setShowAddBonus(true)}
          showAddBonus={showAddBonus} setShowAddBonus={setShowAddBonus} onSaved={loadBonuses}
        />
      ) : (
      <>
      {/* Metric selector — the 8 MoM tables from the FPEM sheet */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {metricDefs.map((m: any) => (
          <button key={m.key} onClick={() => setMetric(m.key)}
            style={{
              fontSize: 12, padding: '6px 11px', borderRadius: 8, cursor: 'pointer',
              border: metric === m.key ? '1px solid #0052cc' : '0.5px solid #D3D1C7',
              background: metric === m.key ? '#EAF1FC' : '#fff',
              color: metric === m.key ? '#0052cc' : '#64748b',
              fontWeight: metric === m.key ? 600 : 400,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input type="text" placeholder="Search name or Tech ID..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={inputStyle}>
          <option value="">All teams</option>
          <option value="WP">WP</option>
          <option value="PMP">PMP</option>
          <option value="IP">IP</option>
        </select>
        {leaders.length > 0 && (
          <select value={leaderFilter} onChange={e => setLeaderFilter(e.target.value)} style={{ ...inputStyle, background: leaderFilter ? '#EAF1FC' : '#fff' }}>
            <option value="">All team leaders</option>
            {leaders.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} style={inputStyle}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALL">All</option>
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={inputStyle}>
          <option value={2026}>2026</option>
          <option value={2025}>2025</option>
        </select>
      </div>

      {/* ── Crew Leader summary table ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', margin: '4px 0 8px' }}>Summary by Crew Leader</div>
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 180, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Crew Leader</th>
                <th style={{ ...th, width: 55 }}>Techs</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 65, background: '#f0f7ff', color: '#0052cc' }}>YTD</th>
                {MONTHS.map(m => <th key={m} style={{ ...th, width: 52, textAlign: 'center' }}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : leaderRollup.length === 0 ? (
                <tr><td colSpan={16} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No data available.</td></tr>
              ) : (
                <>
                  <tr style={{ background: '#F8F7F4' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#F8F7F4', zIndex: 1, fontWeight: 600, fontSize: 12 }}>
                      Total Team <span style={{ color: '#888780', fontWeight: 400 }}>· Std {(standard * 100).toFixed(0)}%</span>
                    </td>
                    <td style={td}></td>
                    <td style={td}></td>
                    {scoreCell(teamAvg.ytd, 'ytd')}
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(teamAvg.monthly?.[m], m))}
                  </tr>
                  {leaderRollup.map(row => (
                    <tr key={row.leader}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                    >
                      <td style={{ ...td, fontWeight: 500, position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>{row.leader}</td>
                      <td style={{ ...td, fontSize: 12, color: '#64748b' }}>{row.memberCount}</td>
                      <td style={{ ...td, fontSize: 12 }}>{row.office}</td>
                      {scoreCell(row.ytd, 'ytd')}
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(row.monthly?.[m], m))}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Individual technician table ── */}
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', margin: '18px 0 8px' }}>By Technician</div>
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                  <th style={{ ...th, width: 55, position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Tech ID</th>
                  <th style={{ ...th, width: 150, position: 'sticky', left: 55, background: '#f8fafc', zIndex: 1 }}>Name</th>
                  <th style={{ ...th, width: 46 }}>Team</th>
                  <th style={{ ...th, width: 55 }}>Office</th>
                  <th style={{ ...th, width: 65, background: '#f0f7ff', color: '#0052cc' }}>YTD</th>
                  {MONTHS.map(m => <th key={m} style={{ ...th, width: 52, textAlign: 'center' }}>{m}</th>)}
                </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={17} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={17} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No data available.</td></tr>
              ) : (
                <>
                  {/* Standard + Team-average summary row */}
                  <tr style={{ background: '#F8F7F4' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#F8F7F4', zIndex: 1, fontSize: 11, color: '#888780' }}>—</td>
                    <td style={{ ...td, position: 'sticky', left: 55, background: '#F8F7F4', zIndex: 1, fontWeight: 600, fontSize: 12 }}>
                      Total Team <span style={{ color: '#888780', fontWeight: 400 }}>· Std {(standard * 100).toFixed(0)}%</span>
                    </td>
                    <td style={td}></td>
                    <td style={td}></td>
                    {scoreCell(teamAvg.ytd, 'ytd')}
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(teamAvg.monthly?.[m], m))}
                  </tr>
                  {filtered.map((t: any) => {
                    const md = mData(t);
                    return (
                      <tr key={t.techId}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                      >
                        <td style={{ ...td, fontSize: 11, color: '#64748b', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>{t.techId}</td>
                        <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'sticky', left: 55, background: 'inherit', zIndex: 1 }}>{t.name}</td>
                        <td style={td}>{teamPill(t.team)}</td>
                        <td style={{ ...td, fontSize: 12 }}>{t.office}</td>
                        {scoreCell(md.ytd, 'ytd')}
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => scoreCell(md.monthly?.[m], m))}
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
        {filtered.length} technicians · {activeMetric?.label} · {year} — crew-leader values are averages of each crew's techs; monthly values are averages of that month's weekly scores
      </div>
      </>
      )}
    </div>
  );
}

// ─── Bonuses sub-view: two grids (Crew Leader + Field Professional) + add modal ───
const BONUS_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function BonusesView({ bonusData, bonusLoading, year, setYear, onAdd, showAddBonus, setShowAddBonus, onSaved }: any) {
  const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : '—';
  const months: string[] = bonusData?.months || [];
  const summary = bonusData?.summary;

  const [lunch, setLunch] = useState<any>(null);
  const [showLunch, setShowLunch] = useState(false);
  useEffect(() => {
    fetch(`/api/field-performance/lunch-winners?year=${year}`).then(r => r.json()).then(setLunch).catch(() => {});
  }, [year]);

  const grid = (title: string, rows: any[], leaderCol: string) => (
    <div style={{ ...card, marginBottom: 16, overflowX: 'auto' }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: '#2C2C2A', padding: '12px 16px', borderBottom: '0.5px solid #E8E7E3' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Tech ID</th>
            <th style={{ ...th, textAlign: 'left' }}>{leaderCol}</th>
            <th style={{ ...th, textAlign: 'left' }}>Branch</th>
            <th style={{ ...th, textAlign: 'right' }}>Immediate</th>
            <th style={{ ...th, textAlign: 'right' }}>Accrued</th>
            <th style={{ ...th, textAlign: 'right' }}>YTD</th>
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => <th key={i} style={{ ...th, textAlign: 'right' }}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={18} style={{ ...td, textAlign: 'center', color: '#B4B2A9', padding: 20 }}>No bonuses recorded.</td></tr>
          ) : rows.map((r: any) => (
            <tr key={r.techId}>
              <td style={{ ...td, fontWeight: 500 }}>{r.techId}</td>
              <td style={td}>{leaderCol.startsWith('Team') ? (r.crewLeader || r.techName) : r.techName}</td>
              <td style={td}>{r.office || '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{money(r.immediate)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#185FA5' }}>{money(r.accrued)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(r.ytd)}</td>
              {months.map((mk: string, i: number) => (
                <td key={i} style={{ ...td, textAlign: 'right', color: r.amounts?.[mk] ? '#2C2C2A' : '#D3D1C7' }}>
                  {r.amounts?.[mk] ? money(r.amounts[mk]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }}>
          {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={onAdd}
          style={{ marginLeft: 'auto', fontSize: 13, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#0052cc', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
          + Add Bonus
        </button>
        <button onClick={() => setShowLunch(true)}
          style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', fontWeight: 500, cursor: 'pointer' }}>
          🍔 Lunch on Critter Stop
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ background: '#F7F6F3', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#6B6A64' }}>Paid immediately YTD</div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{money(summary.immediateYtd)}</div>
          </div>
          <div style={{ background: '#E6F1FB', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#185FA5' }}>Christmas accrued (owed)</div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: '#185FA5' }}>{money(summary.christmasAccrued)}</div>
          </div>
          <div style={{ background: '#F7F6F3', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, color: '#6B6A64' }}>Total bonuses YTD</div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{money(summary.totalYtd)}</div>
          </div>
        </div>
      )}

      {bonusLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#B4B2A9' }}>Loading…</div>
      ) : (
        <>
          {grid('Team Bonuses', bonusData?.team || [], 'Team (Crew Leader)')}
          {grid('Field Professional Bonuses', bonusData?.fieldPro || [], 'Field Professional')}
        </>
      )}

      {/* Performance Incentive criteria reference */}
      <div style={{ ...card, marginBottom: 16, padding: '14px 18px', fontSize: 12.5, color: '#4B4A45', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#2C2C2A', marginBottom: 8 }}>What it takes to hit bonuses</div>
        <div style={{ fontWeight: 600, marginTop: 6 }}>Field Professionals</div>
        <div>Gatekeeper: worked &gt;12 days in the month.</div>
        <div>TEM 93.0–97.9 → <b>$200</b> ($100 paid now + $100 accrued to Christmas).</div>
        <div>TEM ≥98.0 → <b>$300</b> ($150 now + $150 accrued).</div>
        <div>Gritty Growth Award: subjective $50–$100 for leaders to award unscored new hires (add manually).</div>
        <div style={{ fontWeight: 600, marginTop: 8 }}>Team Leaders</div>
        <div>Eligible for the individual TEM bonuses above (same &gt;12-day gate).</div>
        <div>Team-driven: gated on team TEM ≥90.0 AND leader TEM ≥93.0 → $100 per member scoring 93.0–97.9 and $150 per member ≥98.0, split 50% monthly / 50% accrued.</div>
        <div style={{ fontWeight: 600, marginTop: 8 }}>Team lunches</div>
        <div>Weekly: highest average TEM team. Monthly: safest-driving team + highest-reliability team. Up to $14 solo / $18 with another member.</div>
      </div>

      {showAddBonus && <AddBonusModal year={year} onClose={() => setShowAddBonus(false)} onSaved={() => { setShowAddBonus(false); onSaved(); }} />}
      {showLunch && <LunchDrawer lunch={lunch} onClose={() => setShowLunch(false)} />}
    </div>
  );
}

function AddBonusModal({ year, onClose, onSaved }: { year: number; onClose: () => void; onSaved: () => void }) {
  const [techId, setTechId] = useState('');
  const [kind, setKind] = useState<'field_professional' | 'team'>('field_professional');
  const [monthIdx, setMonthIdx] = useState(new Date().getMonth());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!techId.trim() || !amount) { setError('Tech ID and amount are required.'); return; }
    setSaving(true);
    // month-end of the selected month
    const monthEnd = new Date(Date.UTC(year, monthIdx + 1, 0)).toISOString().slice(0, 10);
    const res = await fetch('/api/field-performance/bonuses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ techId: techId.trim().toUpperCase(), kind, month: monthEnd, amount: parseFloat(amount), note: note || undefined }),
    });
    setSaving(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed to save.'); return; }
    onSaved();
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Add Bonus</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#6B6A64' }}>Tech ID
            <input value={techId} onChange={e => setTechId(e.target.value)} placeholder="e.g. W-005"
              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 12, color: '#6B6A64' }}>Type
            <select value={kind} onChange={e => setKind(e.target.value as any)}
              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', fontSize: 13 }}>
              <option value="field_professional">Field Professional</option>
              <option value="team">Team (Crew Leader)</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ fontSize: 12, color: '#6B6A64', flex: 1 }}>Month
              <select value={monthIdx} onChange={e => setMonthIdx(parseInt(e.target.value))}
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', fontSize: 13 }}>
                {BONUS_MONTHS.map((m, i) => <option key={i} value={i}>{m} {year}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: '#6B6A64', flex: 1 }}>Amount ($)
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="0"
                style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', fontSize: 13 }} />
            </label>
          </div>
          <label style={{ fontSize: 12, color: '#6B6A64' }}>Note (optional)
            <input value={note} onChange={e => setNote(e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', fontSize: 13 }} />
          </label>
          {error && <div style={{ color: '#B91C1C', fontSize: 12 }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0052cc', color: '#fff', fontWeight: 500, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Bonus'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LunchDrawer({ lunch, onClose }: { lunch: any; onClose: () => void }) {
  const [tab, setTab] = useState<'weekly' | 'monthly'>('weekly');
  const row = (label: string, team: string, score: number, kind: string, key: number) => (
    <tr key={key} style={{ borderTop: '0.5px solid #F1EFE8' }}>
      <td style={{ padding: '9px 16px', color: '#888780', fontSize: 12 }}>{label}</td>
      <td style={{ padding: '9px 16px', fontSize: 12, color: '#6B6A64' }}>{kind}</td>
      <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 12 }}>{team}'s team <span style={{ color: '#B4B2A9' }}>{(score * 100).toFixed(1)}</span></td>
    </tr>
  );
  const weekly = lunch?.weeklyTem || [];
  const driving = lunch?.monthlyDriving || [];
  const reliability = lunch?.monthlyReliability || [];
  const monthly = [...driving.map((w: any) => ({ ...w, kind: 'Safest driving' })),
                   ...reliability.map((w: any) => ({ ...w, kind: 'Highest reliability' }))]
                   .sort((a, b) => b.period.localeCompare(a.period));

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '0.5px solid #E8E7E3' }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>🍔 Lunch on Critter Stop <span style={{ fontWeight: 400, fontSize: 12, color: '#888780' }}>· up to $14 solo / $18 with another member</span></div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#888780' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '12px 20px 0' }}>
          {(['weekly', 'monthly'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 500,
                border: tab === t ? '1px solid #0052cc' : '0.5px solid #D3D1C7',
                background: tab === t ? '#0052cc' : '#fff', color: tab === t ? '#fff' : '#2C2C2A' }}>
              {t === 'weekly' ? 'Weekly (Highest TEM)' : 'Monthly (Driving + Reliability)'}
            </button>
          ))}
        </div>
        <div style={{ overflow: 'auto', padding: '12px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {tab === 'weekly' ? (
                weekly.length === 0
                  ? <tr><td style={{ padding: 24, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>No winners recorded yet — recognition starts week ending 8/7.</td></tr>
                  : weekly.map((w: any, i: number) => row(w.label, w.team, w.score, "Highest team TEM", i))
              ) : (
                monthly.length === 0
                  ? <tr><td style={{ padding: 24, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>No winners recorded yet — recognition starts week ending 8/7.</td></tr>
                  : monthly.map((w: any, i: number) => row(w.label, w.team, w.score, w.kind, i))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
