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
import { MoMTab } from './MoMTab';
import { ManualAdjTab } from './ManualAdjTab';

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
  const [activeTab, setActiveTab] = useState<'scoreboard' | 'individuals' | 'teams' | 'roster' | 'attendance' | 'driving' | 'mom' | 'adjustments'>('scoreboard');
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
          {(['scoreboard', 'individuals', 'teams', 'roster', 'attendance', 'driving', 'mom', 'adjustments'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={navStyle(activeTab === tab)}>
              {tab === 'mom' ? 'MoM' : tab === 'adjustments' ? 'Adjustments' : tab.charAt(0).toUpperCase() + tab.slice(1)}
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
          {activeTab !== 'roster' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
            </div>
          )}
        </div>
          {role === 'ADMIN' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => runSync('fp')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: syncing === 'fp' ? '#F1EFE8' : '#fff', cursor: syncing ? 'default' : 'pointer', color: '#888780', whiteSpace: 'nowrap' as const }}>
                {syncing === 'fp' ? 'Syncing...' : '↻ FR Sync'}
              </button>
              <button onClick={() => runSync('bouncie')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: syncing === 'bouncie' ? '#F1EFE8' : '#fff', cursor: syncing ? 'default' : 'pointer', color: '#888780', whiteSpace: 'nowrap' as const }}>
                {syncing === 'bouncie' ? 'Syncing...' : '↻ Bouncie'}
              </button>
              <button onClick={() => runSync('reliability')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: syncing === 'reliability' ? '#F1EFE8' : '#fff', cursor: syncing ? 'default' : 'pointer', color: '#888780', whiteSpace: 'nowrap' as const }}>
                {syncing === 'reliability' ? 'Syncing...' : '↻ Reliability'}
              </button>
              <button onClick={() => runSync('geocode')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: syncing === 'geocode' ? '#F1EFE8' : '#fff', cursor: syncing ? 'default' : 'pointer', color: '#888780', whiteSpace: 'nowrap' as const }}>
                {syncing === 'geocode' ? 'Geocoding...' : '↻ Geocode'}
              </button>
              <button onClick={() => runSync('addresses')} disabled={!!syncing}
                style={{ padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: syncing === 'addresses' ? '#F1EFE8' : '#fff', cursor: syncing ? 'default' : 'pointer', color: '#888780', whiteSpace: 'nowrap' as const }}>
                {syncing === 'addresses' ? 'Syncing...' : '↻ Addresses'}
              </button>
            </div>
          )}
      </div>
      {syncMsg && <div style={{ fontSize: 12, color: '#888780', marginBottom: 8, padding: '6px 12px', background: '#F8F7F4', borderRadius: 8, border: '0.5px solid #E8E7E3', fontWeight: 500 }}>{syncMsg}</div>}

      {/* Tab content */}
      {activeTab === 'scoreboard' && <ScoreboardTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'individuals' && <IndividualsTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'teams' && <TeamsTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'roster' && <RosterTab office={officeParam} />}
      {activeTab === 'attendance' && <AttendanceTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'driving' && <DrivingTab office={officeParam} weekEnd={selectedWeek} />}
      {activeTab === 'mom' && <MoMTab office={officeParam} />}
      {activeTab === 'adjustments' && <ManualAdjTab office={officeParam} weekEnd={selectedWeek} />}
    </div>
  );
}
