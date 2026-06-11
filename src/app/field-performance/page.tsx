'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ScoreboardTab } from './ScoreboardTab';
import { IndividualsTab } from './IndividualsTab';
import { TeamsTab } from './TeamsTab';
import { RosterTab } from './RosterTab';
import { AttendanceTab } from './AttendanceTab';
import { DrivingTab } from './DrivingTab';

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
  const [activeTab, setActiveTab] = useState<'scoreboard' | 'individuals' | 'teams' | 'roster' | 'attendance' | 'driving'>('scoreboard');
  const [office, setOffice] = useState('All');
  const [weekIdx, setWeekIdx] = useState(0);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const role = (session?.user as any)?.role;
  const canView = ['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role);

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

  const runSync = async (type: 'fp' | 'bouncie' | 'reliability' | 'geocode' | 'addresses') => {
    setSyncing(type);
    setSyncMsg(null);
    const wk = selectedWeek.toLocaleDateString('en-CA');

    if (type === 'geocode') {
      let totalGeocoded = 0;
      let remaining = 1;
      let consecutiveErrors = 0;
      while (remaining > 0 && consecutiveErrors < 3) {
        try {
          const res = await fetch('/api/geocode/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            consecutiveErrors++;
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          const data = await res.json();
          totalGeocoded += data.geocoded ?? 0;
          remaining = data.remaining ?? 0;
          consecutiveErrors = 0;
          setSyncMsg(`Geocoding... ${totalGeocoded} done, ${remaining} remaining`);
          if (data.status === 'done' || remaining === 0) break;
          // Small pause between batches
          await new Promise(r => setTimeout(r, 300));
        } catch {
          consecutiveErrors++;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (consecutiveErrors >= 3) {
        setSyncMsg(`Geocoding paused — ${totalGeocoded} done, ${remaining} remaining. Click again to continue.`);
      } else {
        setSyncMsg(`Geocoding complete — ${totalGeocoded} customers geocoded`);
      }
      setSyncing(null);
      return;
    }

    const url = type === 'fp' ? '/api/field-performance/sync-test' : type === 'bouncie' ? '/api/bouncie/sync-test' : type === 'reliability' ? '/api/reliability/sync-test' : '/api/addresses/run';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekEnd: wk }),
      });
      const data = await res.json();
      const label = type === 'fp' ? 'FR' : type === 'bouncie' ? 'Bouncie' : type === 'reliability' ? 'Reliability' : 'Addresses';
      const detail = type === 'addresses' ? `${data.totalUpdated ?? 0} addresses updated` : `${data.techsUpdated ?? 0} techs updated`;
      setSyncMsg(`${label} sync: ${data.status} — ${detail}`);
    } catch {
      setSyncMsg('Sync failed');
    }
    setSyncing(null);
  };
  const officeParam = office === 'All' ? 'ALL' : office;

  const navStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 500,
    color: active ? '#0f172a' : '#475569',
    background: active ? '#ffffff' : 'transparent',
    border: active ? '1px solid #dbe3ee' : '1px solid transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  });

  const offBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    color: active ? '#0f172a' : '#475569',
    background: active ? '#ffffff' : 'transparent',
    border: active ? '1px solid #dbe3ee' : '1px solid transparent',
    cursor: 'pointer',
  });

  return (
    <div style={{ padding: '24px 24px 48px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {/* Tab nav */}
        <div style={{ display: 'inline-flex', gap: 2, padding: 4, borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          {(['scoreboard', 'individuals', 'teams', 'roster', 'attendance', 'driving'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={navStyle(activeTab === tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Office + week */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            {OFFICES.map(o => (
              <button key={o} onClick={() => setOffice(o)} style={offBtnStyle(office === o)}>{o}</button>
            ))}
          </div>
          {activeTab !== 'roster' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button
                onClick={() => setWeekIdx(i => Math.min(i + 1, WEEKS.length - 1))}
                style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >‹</button>
              <span style={{ fontSize: 12, color: '#64748b', minWidth: 90, textAlign: 'center' }}>Wk of {fmtWeek(selectedWeek)}</span>
              <button
                onClick={() => setWeekIdx(i => Math.max(i - 1, 0))}
                disabled={weekIdx === 0}
                style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #e2e8f0', background: weekIdx === 0 ? '#f1f5f9' : '#f8fafc', cursor: weekIdx === 0 ? 'default' : 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: weekIdx === 0 ? 0.4 : 1 }}
              >›</button>
            </div>
          )}
        </div>
          {role === 'ADMIN' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => runSync('fp')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: syncing === 'fp' ? '#f1f5f9' : '#f8fafc', cursor: syncing ? 'default' : 'pointer', color: '#475569', whiteSpace: 'nowrap' as const }}>
                {syncing === 'fp' ? 'Syncing...' : '↻ FR Sync'}
              </button>
              <button onClick={() => runSync('bouncie')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: syncing === 'bouncie' ? '#f1f5f9' : '#f8fafc', cursor: syncing ? 'default' : 'pointer', color: '#475569', whiteSpace: 'nowrap' as const }}>
                {syncing === 'bouncie' ? 'Syncing...' : '↻ Bouncie'}
              </button>
              <button onClick={() => runSync('reliability')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: syncing === 'reliability' ? '#f1f5f9' : '#f8fafc', cursor: syncing ? 'default' : 'pointer', color: '#475569', whiteSpace: 'nowrap' as const }}>
                {syncing === 'reliability' ? 'Syncing...' : '↻ Reliability'}
              </button>
              <button onClick={() => runSync('geocode')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: syncing === 'geocode' ? '#f1f5f9' : '#f8fafc', cursor: syncing ? 'default' : 'pointer', color: '#475569', whiteSpace: 'nowrap' as const }}>
                {syncing === 'geocode' ? 'Geocoding...' : '↻ Geocode'}
              </button>
              <button onClick={() => runSync('addresses')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: syncing === 'addresses' ? '#f1f5f9' : '#f8fafc', cursor: syncing ? 'default' : 'pointer', color: '#475569', whiteSpace: 'nowrap' as const }}>
                {syncing === 'addresses' ? 'Syncing...' : '↻ Addresses'}
              </button>
            </div>
          )}
      </div>
      {syncMsg && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>{syncMsg}</div>}

      {/* Tab content */}
      {activeTab === 'scoreboard' && <ScoreboardTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'individuals' && <IndividualsTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'teams' && <TeamsTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'roster' && <RosterTab office={officeParam} />}
      {activeTab === 'attendance' && <AttendanceTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'driving' && <DrivingTab office={officeParam} weekEnd={selectedWeek} />}
    </div>
  );
}
