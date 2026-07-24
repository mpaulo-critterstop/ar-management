'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { isOwnDataOnly } from '@/lib/access';
import { ScoreboardTab } from './ScoreboardTab';
import { IndividualsTab } from './IndividualsTab';
import { TeamsTab } from './TeamsTab';
import { RosterTab } from './RosterTab';
import { AttendanceTab } from './AttendanceTab';
import { DrivingTab } from './DrivingTab';
import { MoMTab } from './MoMTab';
import { ManualAdjTab } from './ManualAdjTab';
import { TcAccountabilityTab } from './TcAccountabilityTab';
import { RoutesTab } from './RoutesTab';

const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];

function getMostRecentFriday(offset = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 5=Fri
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offset * 7);
  return d;
}

const WEEKS = Array.from({ length: 26 }, (_, i) => getMostRecentFriday(i));

function fmtWeek(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function FieldPerformancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'scoreboard' | 'individuals' | 'teams' | 'roster' | 'attendance' | 'tc-accountability' | 'driving' | 'routes' | 'mom' | 'adjustments'>('scoreboard');
  const [office, setOffice] = useState('All');
  const [weekIdx, setWeekIdx] = useState(0);
  const [periodMode, setPeriodMode] = useState<'week' | 'month'>('week');
  const now = new Date();
  const [selMonth, setSelMonth] = useState(now.getUTCMonth() + 1); // 1-12
  const [selYear, setSelYear] = useState(now.getUTCFullYear());
  const [leaderFilter, setLeaderFilter] = useState('');
  const [leaders, setLeaders] = useState<string[]>([]);

  // Populate the team-leader dropdown from CREW LEADERS only (site leaders are a different tier).
  // A crew leader appears only if they lead at least one tech OTHER than themselves — this excludes
  // hybrid/self-assigned leaders (e.g. a service manager listed as crew leader to himself). The list
  // auto-updates whenever crewLeader assignments change in the Roster tab.
  useEffect(() => {
    fetch('/api/field-performance/roster?status=ACTIVE')
      .then(r => r.json())
      .then((techs: any[]) => {
        if (!Array.isArray(techs)) return;
        const counts = new Map<string, number>(); // crew leader -> # of OTHER techs led
        techs.forEach(t => {
          if (!t.crewLeader) return;
          if (t.crewLeader === t.name) return; // self-assignment doesn't count
          counts.set(t.crewLeader, (counts.get(t.crewLeader) || 0) + 1);
        });
        const list = [...counts.entries()].filter(([, n]) => n > 0).map(([leader]) => leader);
        setLeaders(list.sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    // Own-data techs belong on their personal view, not the management dashboard.
    if (status === 'authenticated' && isOwnDataOnly(session?.user as any)) {
      router.replace('/my-performance');
    }
  }, [status, router, session]);

  const role = (session?.user as any)?.role;
  const canView = ['Admin', 'Manager'].includes(role);

  if (status === 'loading') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b' }}>
      Loading...
    </div>
  );

  if (!canView) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b' }}>
      You don't have access to Field Professional Effort Meter.
    </div>
  );

  const selectedWeek = WEEKS[weekIdx];

  // The period passed to tabs: either a single week, or a month range (by weekEnd month).
  const period = periodMode === 'month'
    ? {
        mode: 'month' as const,
        month: selMonth,
        year: selYear,
        // month range in UTC: first day 00:00 to last day 23:59:59
        monthStart: new Date(Date.UTC(selYear, selMonth - 1, 1)).toISOString(),
        monthEnd: new Date(Date.UTC(selYear, selMonth, 0, 23, 59, 59)).toISOString(),
      }
    : { mode: 'week' as const, week: selectedWeek };

  const officeParam = office === 'All' ? 'ALL' : office;

  const navStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 500,
    color: active ? '#2C2C2A' : '#888780',
    background: active ? '#ffffff' : 'transparent',
    border: active ? '0.5px solid #D3D1C7' : '0.5px solid transparent',
    boxShadow: active ? '0 1px 3px rgba(44,44,42,0.08)' : 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.15s',
  });

  const offBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    color: active ? '#2C2C2A' : '#888780',
    background: active ? '#ffffff' : 'transparent',
    border: active ? '0.5px solid #D3D1C7' : '0.5px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '24px 24px 48px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Title */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Field Professional Effort Meter</h1>
      </div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {/* Tab nav */}
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {(['scoreboard', 'individuals', 'teams', 'roster', 'attendance', 'tc-accountability', 'driving', 'routes', 'mom', 'adjustments'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={navStyle(activeTab === tab)}>
              {tab === 'mom' ? 'MoM' : tab === 'adjustments' ? 'Adjustments' : tab === 'tc-accountability' ? 'TC Accountability' : tab === 'routes' ? 'PC Routes' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Office + week */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
            {OFFICES.map(o => (
              <button key={o} onClick={() => setOffice(o)} style={offBtnStyle(office === o)}>{o}</button>
            ))}
          </div>
          {activeTab !== 'roster' && activeTab !== 'mom' && activeTab !== 'adjustments' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {/* Week / Month mode toggle */}
              <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1EFE8', border: '0.5px solid #E8E7E3', marginRight: 4 }}>
                <button onClick={() => setPeriodMode('week')} style={offBtnStyle(periodMode === 'week')}>Week</button>
                <button onClick={() => setPeriodMode('month')} style={offBtnStyle(periodMode === 'month')}>Month</button>
              </div>
              {periodMode === 'week' ? (
                <>
                  <button
                    onClick={() => setWeekIdx(i => Math.min(i + 1, WEEKS.length - 1))}
                    style={{ width: 28, height: 28, borderRadius: 7, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888780' }}
                  >‹</button>
                  <span style={{ fontSize: 12, color: '#888780', minWidth: 90, textAlign: 'center', fontWeight: 500 }}>Wk of {fmtWeek(selectedWeek)}</span>
                  <button
                    onClick={() => setWeekIdx(i => Math.max(i - 1, 0))}
                    disabled={weekIdx === 0}
                    style={{ width: 28, height: 28, borderRadius: 7, border: '0.5px solid #D3D1C7', background: weekIdx === 0 ? '#F1EFE8' : '#fff', cursor: weekIdx === 0 ? 'default' : 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888780', opacity: weekIdx === 0 ? 0.4 : 1 }}
                  >›</button>
                </>
              ) : (
                <>
                  <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}
                    style={{ fontSize: 12, padding: '6px 9px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#444441', cursor: 'pointer' }}>
                    {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <select value={selYear} onChange={e => setSelYear(Number(e.target.value))}
                    style={{ fontSize: 12, padding: '6px 9px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#444441', cursor: 'pointer' }}>
                    {[2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </>
              )}
            </div>
          )}
          {/* Team-leader filter — applies to score/individuals/driving/attendance/tc tabs */}
          {!['roster', 'mom', 'teams'].includes(activeTab) && leaders.length > 0 && (
            <select
              value={leaderFilter}
              onChange={e => setLeaderFilter(e.target.value)}
              style={{ fontSize: 12, padding: '6px 9px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: leaderFilter ? '#EAF1FC' : '#fff', color: '#444441', cursor: 'pointer' }}
              title="Filter by team leader"
            >
              <option value="">All team leaders</option>
              {leaders.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>
          {/* Manual sync buttons removed — these operations run via scheduled crons.
              Endpoints remain live: /api/field-performance/{run,week,routeCustomers,pmpAppointments,completion},
              /api/tc-accountability/run, /api/cron/{bouncie,reliability,geocode,sync-addresses,field-performance}. */}
      </div>

      {/* Tab content */}
      {activeTab === 'scoreboard' && <ScoreboardTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} period={period} />}
      {activeTab === 'individuals' && <IndividualsTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} period={period} />}
      {activeTab === 'teams' && <TeamsTab office={officeParam} weekEnd={selectedWeek} period={period} />}
      {activeTab === 'roster' && <RosterTab office={officeParam} />}
      {activeTab === 'attendance' && <AttendanceTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} period={period} />}
      {activeTab === 'tc-accountability' && <TcAccountabilityTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} period={period} />}
      {activeTab === 'driving' && <DrivingTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} period={period} />}
      {activeTab === 'routes' && <RoutesTab office={officeParam} weekEnd={selectedWeek} leaderFilter={leaderFilter} />}
      {activeTab === 'mom' && <MoMTab office={officeParam} />}
      {activeTab === 'adjustments' && <ManualAdjTab office={officeParam} weekEnd={selectedWeek} />}
    </div>
  );
}
