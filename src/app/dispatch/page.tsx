'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';
import { LastSynced } from '@/components/LastSynced';
import { PageHeader as CCPageHeader, FilterChips as CCFilterChips, SearchBox as CCSearchBox, DataTable as CCDataTable, CustomerCell as CCCustomerCell } from '@/components/cc/Layout';
import { Btn as CCBtn } from '@/components/cc/Primitives';

const ACCENT = '#5B9BE0';
const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];
const STAGE_FILTERS = [
  { label: 'All active', value: 'all' },
  { label: 'Exclusion pending', value: 'exclusion_pending' },
  { label: 'Trap checks', value: 'trap_checks' },
  { label: 'FAR pending', value: 'far_pending' },
  { label: 'Needs attention', value: 'needs_attention' },
  { label: 'Closed this month', value: 'closed_this_month' },
];

const TODAY = new Date();

function daysSince(date: string | null) {
  if (!date) return null;
  return Math.floor((TODAY.getTime() - new Date(date).getTime()) / 86400000);
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StageChip({ done, label, date }: { done: boolean; label: string; date?: string | null }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      background: done ? '#143229' : '#232329',
      color: done ? '#0F6E56' : '#908E85',
      whiteSpace: 'nowrap',
    }}>
      {done ? '✓' : '○'} {label}
      {done && date && <span style={{ color: '#63615A', fontWeight: 400 }}>· {new Date(date).toLocaleDateString()}</span>}
    </span>
  );
}

function AttentionFlag({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 500, background: '#352a16', color: '#DBA14E',
    }}>
      {'\u26A0'} {label}
    </span>
  );
}

export default function DispatchPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [jobs, setJobs] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('DFW');
  const [stageFilter, setStageFilter] = useState('all');
  const [customerSearch, setCustomerSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [toast, setToast] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [stageEdit, setStageEdit] = useState<any>({});
  const [savingStage, setSavingStage] = useState(false);
  const [sortBy, setSortBy] = useState<string>('soldDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && !canAccessModule(session?.user as any, 'dispatch')) router.replace('/');
  }, [status, router]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'All') params.set('office', office);
    if (stageFilter !== 'all') params.set('stage', stageFilter);
    params.set('status', 'ACTIVE');
    const res = await fetch('/api/dispatch?' + params.toString());
    const data = await res.json();
    setJobs(data.jobs || []);
    setKpis(data.kpis || null);
    setCurrentPage(1);
    setLoading(false);
  }, [office, stageFilter]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }


  async function saveStage() {
    setSavingStage(true);
    try {
      await fetch('/api/dispatch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingJob.id, stageEdit }),
      });
      setEditingJob(null);
      setStageEdit({});
      showToast('Stage updated!');
      fetchJobs();
    } catch {
      showToast('Save failed');
    }
    setSavingStage(false);
  }

  function getStage(job: any) {
    if (job.closedOut) return { label: 'Closed out', color: '#43B892', bg: '#143229' };
    if (job.hasExclusion && !job.exclusionDone) return { label: 'Exclusion pending', color: '#a32d2d', bg: '#361e1e' };
    if (job.hasTrapping && job.trapCheckCount === 0 && !job.trapsDone) return { label: 'Trapping pending', color: '#9D8BE6', bg: '#241f36' };
    if (job.hasTrapping && job.trapCheckCount > 0 && !job.trapsDone) return { label: 'Trapping in progress', color: '#185fa5', bg: '#15263a' };
    if (job.hasFAR && !job.farDone) return { label: 'FAR pending', color: '#854f0b', bg: '#352a16' };
    return { label: 'Active', color: '#908E85', bg: '#232329' };
  }

  function getFlags(job: any) {
    const flags: string[] = [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    if (new Date(job.updatedAt) < sevenDaysAgo && !job.closedOut) flags.push('No update 7+ days');
    if (job.hasTrapping && job.trapCheckCount >= 3 && !job.trapsDone) flags.push(job.trapCheckCount + ' trap checks');
    return flags;
  }

  // Customer search (client-side filter on the loaded jobs).
  const searchLower = customerSearch.trim().toLowerCase();
  const filteredJobs = (searchLower
    ? jobs.filter(j => (j.customer?.name || '').toLowerCase().includes(searchLower))
    : jobs
  ).slice().sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    // Value extractors per sortable column. null values always sort LAST regardless of direction.
    const val = (j: any): string | number | null => {
      switch (sortBy) {
        case 'customer': return (j.customer?.name || '').toLowerCase() || null;
        case 'pm': return (j.pmName || '').toLowerCase() || null;
        case 'soldDate': return j.invoice?.date ? new Date(j.invoice.date).getTime() : null;
        case 'daysSold': return j.invoice?.date ? new Date(j.invoice.date).getTime() : null; // older sold = more days; sort by date
        case 'lastUpdate': return j.updatedAt ? new Date(j.updatedAt).getTime() : null;
        case 'stage': return getStage(j).label?.toLowerCase() || null;
        case 'trapChecks': return j.hasTrapping ? (j.trapCheckCount || 0) : null;
        default: return null;
      }
    };
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    // "Days since sold" is inverse of date: more days = older date. When sorting daysSold asc (fewest days),
    // that's newest date first, so flip.
    if (sortBy === 'daysSold') return (vb < va ? -1 : vb > va ? 1 : 0) * dir * -1;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir(col === 'customer' || col === 'pm' || col === 'stage' ? 'asc' : 'desc'); }
    setCurrentPage(1);
  };
  const sortArrow = (col: string) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPages = Math.ceil(filteredJobs.length / pageSize);
  const displayed = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const current = editingJob ? { ...editingJob, ...stageEdit } : null;

  if (status === 'loading') return null;

  return (
    <div style={{ padding: '30px 34px 70px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#121216', margin: '0 -34px', padding: '2px 34px 6px' }}>
      <CCPageHeader icon="🚚" title="Dispatcher" subtitle="Active exclusion jobs, trap checks, FAR progress and close-outs"
        actions={<LastSynced office={office} />} />

      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#143229', color: '#43B892', border: '0.5px solid #2e5a4c', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}

      {editingJob && current && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div style={{ background: '#1C1C21', border: '1px solid #35353C', borderRadius: 14, padding: 24, width: 440, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,.5)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{editingJob.customer?.name}</div>
                <div style={{ fontSize: 12, color: '#908E85' }}>Invoice #{editingJob.invoice?.externalId}</div>
              </div>
              <button onClick={() => { setEditingJob(null); setStageEdit({}); }} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#908E85' }}>
                X
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {editingJob.hasExclusion && (
                <div style={{ padding: 12, background: '#232329', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#F0EEE8' }}>Exclusion</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="excDone" checked={!!current.exclusionDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, exclusionDone: e.target.checked }))} />
                    <label htmlFor="excDone" style={{ fontSize: 12 }}>Exclusion done</label>
                  </div>
                  {current.exclusionDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#908E85', width: 80 }}>Date:</label>
                      <input type="date"
                        value={stageEdit.exclusionDate || (editingJob.exclusionDate ? editingJob.exclusionDate.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, exclusionDate: e.target.value }))}
                        style={{ fontSize: 12, padding: '4px 7px', border: '1px solid #35353C', borderRadius: 6, background: '#26262C', color: '#F0EEE8' }} />
                    </div>
                  )}
                </div>
              )}

              {editingJob.hasTrapping && (
                <div style={{ padding: 12, background: '#232329', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#F0EEE8' }}>Trapping</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="trapDone" checked={!!current.trapsDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, trapsDone: e.target.checked }))} />
                    <label htmlFor="trapDone" style={{ fontSize: 12 }}>Trapping done</label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: '#908E85', width: 80 }}>Trap checks:</label>
                    <input type="number" min={0}
                      value={stageEdit.trapCheckCount || editingJob.trapCheckCount}
                      onChange={e => setStageEdit((p: any) => ({ ...p, trapCheckCount: Number(e.target.value) }))}
                      style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #63615A', borderRadius: 4, width: 60 }} />
                  </div>
                  {current.trapsDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#908E85', width: 80 }}>Last check:</label>
                      <input type="date"
                        value={stageEdit.lastTrapCheck || (editingJob.lastTrapCheck ? editingJob.lastTrapCheck.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, lastTrapCheck: e.target.value }))}
                        style={{ fontSize: 12, padding: '4px 7px', border: '1px solid #35353C', borderRadius: 6, background: '#26262C', color: '#F0EEE8' }} />
                    </div>
                  )}
                </div>
              )}

              {editingJob.hasFAR && (
                <div style={{ padding: 12, background: '#232329', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#F0EEE8' }}>FAR</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="farDone" checked={!!current.farDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, farDone: e.target.checked }))} />
                    <label htmlFor="farDone" style={{ fontSize: 12 }}>FAR done</label>
                  </div>
                  {current.farDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#908E85', width: 80 }}>Date:</label>
                      <input type="date"
                        value={stageEdit.farDate || (editingJob.farDate ? editingJob.farDate.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, farDate: e.target.value }))}
                        style={{ fontSize: 12, padding: '4px 7px', border: '1px solid #35353C', borderRadius: 6, background: '#26262C', color: '#F0EEE8' }} />
                    </div>
                  )}
                </div>
              )}

              <div style={{ padding: 12, background: '#232329', borderRadius: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#F0EEE8' }}>Close out</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="checkbox" id="closedOut" checked={!!current.closedOut}
                    onChange={e => setStageEdit((p: any) => ({ ...p, closedOut: e.target.checked }))} />
                  <label htmlFor="closedOut" style={{ fontSize: 12 }}>Closed out</label>
                </div>
                {current.closedOut && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 11, color: '#908E85', width: 80 }}>Date:</label>
                    <input type="date"
                      value={stageEdit.closedOutDate || (editingJob.closedOutDate ? editingJob.closedOutDate.split('T')[0] : '')}
                      onChange={e => setStageEdit((p: any) => ({ ...p, closedOutDate: e.target.value }))}
                      style={{ fontSize: 12, padding: '4px 7px', border: '1px solid #35353C', borderRadius: 6, background: '#26262C', color: '#F0EEE8' }} />
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditingJob(null); setStageEdit({}); }}
                style={{ padding: '6px 16px', fontSize: 12, borderRadius: 6, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveStage} disabled={savingStage}
                style={{ padding: '6px 16px', fontSize: 12, borderRadius: 6, border: 'none', background: ACCENT, color: '#1C1C21', cursor: 'pointer', opacity: savingStage ? 0.7 : 1 }}>
                {savingStage ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {OFFICES.map(o => { const on = office===o; return (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on?'#5B9BE0':'#2A2A30'}`, background: on?'#15263a':'#1C1C21', color: on?'#5B9BE0':'#908E85' }}>{o}</button>
          );})}
        </div>
        <select value={stageFilter} onChange={e => { setStageFilter(e.target.value); setCurrentPage(1); }}
          style={{ fontSize: 12.5, padding: '8px 11px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8', cursor: 'pointer' }}>
          {STAGE_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', minWidth: 230 }}>
          <CCSearchBox value={customerSearch} onChange={(v: string) => { setCustomerSearch(v); setCurrentPage(1); }} placeholder="Search customer…" />
        </div>
      </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {kpis && (
        <CCFilterChips
          active={stageFilter}
          onChange={(k: string) => { setStageFilter(k); setCurrentPage(1); }}
          chips={[
            { key: 'all', label: 'Active jobs', value: loading ? '…' : kpis.total, valueTone: 'blue' },
            { key: 'exclusion_pending', label: 'Exclusion pending', value: loading ? '…' : kpis.exclusionPending, valueTone: 'red' },
            { key: 'trap_checks', label: 'Trap checks', value: loading ? '…' : kpis.trapChecks, valueTone: 'blue' },
            { key: 'far_pending', label: 'FAR pending', value: loading ? '…' : kpis.farPending, valueTone: 'amber' },
            { key: 'needs_attention', label: 'Needs attention', value: loading ? '…' : kpis.needsAttention, valueTone: 'amber' },
            { key: 'closed_this_month', label: 'Closed this month', value: loading ? '…' : kpis.closedThisMonth, valueTone: 'green' },
          ]}
        />
      )}

        {/* sortable column header helper for cc DataTable labels */}
        <CCDataTable
          rowKey={(job: any) => job.id}
          empty={loading ? 'Loading…' : (customerSearch ? `No jobs matching "${customerSearch}"` : 'No jobs found')}
          cols={[
            { key: 'edit', label: '', render: (job: any) => <CCBtn variant="secondary" style={{ padding: '4px 11px', fontSize: 12 }} onClick={() => { setEditingJob(job); setStageEdit({}); }}>Edit</CCBtn> },
            { key: 'customer', label: <span onClick={() => toggleSort('customer')} style={{ cursor: 'pointer' }}>Customer{sortArrow('customer')}</span> as any, render: (job: any) => {
              const flags = getFlags(job);
              return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {flags.length > 0 && <span title="Needs attention" style={{ color: '#DBA14E' }}>⚑</span>}
                <CCCustomerCell name={job.customer?.name || '—'} sub={job.customer?.serviceAddr?.split(',')[0] || undefined} />
              </div>;
            } },
            { key: 'pm', label: <span onClick={() => toggleSort('pm')} style={{ cursor: 'pointer' }}>PM{sortArrow('pm')}</span> as any, render: (job: any) => <span style={{ color: '#C9C7BF' }}>{job.pmName || '—'}</span> },
            { key: 'invoice', label: 'Invoice', render: (job: any) => <div><div style={{ color: '#908E85', fontVariantNumeric: 'tabular-nums' }}>{job.invoice?.externalId || '—'}</div><div style={{ fontSize: 11, color: '#43B892', fontWeight: 600 }}>{job.invoice?.amount ? fmt(job.invoice.amount) : ''}</div></div> },
            { key: 'soldDate', label: <span onClick={() => toggleSort('soldDate')} style={{ cursor: 'pointer' }}>Sold{sortArrow('soldDate')}</span> as any, render: (job: any) => { const d = job.invoice?.date ? daysSince(job.invoice.date) : null; return <div><div style={{ color: '#908E85', fontSize: 12 }}>{job.invoice?.date ? job.invoice.date.split('T')[0] : '—'}</div>{d !== null && <div style={{ fontSize: 11, color: d > 30 ? '#E57C7C' : '#63615A', fontWeight: d > 30 ? 600 : 400 }}>{d}d ago</div>}</div>; } },
            { key: 'lastUpdate', label: <span onClick={() => toggleSort('lastUpdate')} style={{ cursor: 'pointer' }}>Updated{sortArrow('lastUpdate')}</span> as any, align: 'right', render: (job: any) => { const d = daysSince(job.updatedAt); return d !== null ? <span style={{ color: d > 7 ? '#DBA14E' : '#908E85', fontVariantNumeric: 'tabular-nums' }}>{d}d</span> : '—'; } },
            { key: 'stage', label: <span onClick={() => toggleSort('stage')} style={{ cursor: 'pointer' }}>Stage{sortArrow('stage')}</span> as any, render: (job: any) => { const stage = getStage(job); return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: stage.bg, color: stage.color }}>{stage.label}</span>; } },
            { key: 'stages', label: 'Stages', wrap: true, render: (job: any) => <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 150, whiteSpace: 'normal' }}>
              {job.hasExclusion && <StageChip done={job.exclusionDone} label="Exclusion" date={job.exclusionDate} />}
              {job.hasTrapping && <StageChip done={job.trapsDone} label="Trapping" date={job.lastTrapCheck} />}
              {job.hasFAR && <StageChip done={job.farDone} label="FAR" date={job.farDate} />}
            </div> },
            { key: 'trapChecks', label: <span onClick={() => toggleSort('trapChecks')} style={{ cursor: 'pointer' }}>Traps{sortArrow('trapChecks')}</span> as any, align: 'right', render: (job: any) => job.hasTrapping ? <div><span style={{ fontWeight: 600, color: job.trapCheckCount >= 3 ? '#E57C7C' : '#F0EEE8', fontVariantNumeric: 'tabular-nums' }}>{job.trapCheckCount}</span>{job.lastTrapCheck && <div style={{ fontSize: 10.5, color: '#908E85' }}>{job.lastTrapCheck.split('T')[0]}</div>}</div> : <span style={{ color: '#63615A' }}>—</span> },
            { key: 'flags', label: 'Flags', wrap: true, render: (job: any) => <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 120, whiteSpace: 'normal' }}>{getFlags(job).map((f: string) => <AttentionFlag key={f} label={f} />)}</div> },
          ]}
          rows={displayed}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#908E85' }}>
            Showing {filteredJobs.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}{'\u2013'}{Math.min(currentPage * pageSize, filteredJobs.length)} of {filteredJobs.length} jobs
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12.5, padding: '3px 7px', border: '1px solid #35353C', borderRadius: 6, marginLeft: 8, background: '#26262C', color: '#F0EEE8' }}>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select> per page
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <CCBtn variant="secondary" style={{ padding: '5px 11px', fontSize: 12 }} disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>Prev</CCBtn>
            <span style={{ fontSize: 12, color: '#908E85' }}>{currentPage} / {totalPages || 1}</span>
            <CCBtn variant="secondary" style={{ padding: '5px 11px', fontSize: 12 }} disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>Next</CCBtn>
          </div>
        </div>
    </div>
  );
}
