'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';
import { LastSynced } from '@/components/LastSynced';

const ACCENT = '#0052cc';
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
      background: done ? '#E1F5EE' : '#F1EFE8',
      color: done ? '#0F6E56' : '#888780',
      whiteSpace: 'nowrap',
    }}>
      {done ? '✓' : '○'} {label}
      {done && date && <span style={{ color: '#B4B2A9', fontWeight: 400 }}>· {new Date(date).toLocaleDateString()}</span>}
    </span>
  );
}

function AttentionFlag({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 500, background: '#FAEEDA', color: '#854F0B',
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
    if (job.closedOut) return { label: 'Closed out', color: '#1d9e75', bg: '#e1f5ee' };
    if (job.hasExclusion && !job.exclusionDone) return { label: 'Exclusion pending', color: '#a32d2d', bg: '#fcebeb' };
    if (job.hasTrapping && job.trapCheckCount === 0 && !job.trapsDone) return { label: 'Trapping pending', color: '#5B3FA6', bg: '#EEEBF8' };
    if (job.hasTrapping && job.trapCheckCount > 0 && !job.trapsDone) return { label: 'Trapping in progress', color: '#185fa5', bg: '#e6f1fb' };
    if (job.hasFAR && !job.farDone) return { label: 'FAR pending', color: '#854f0b', bg: '#faeeda' };
    return { label: 'Active', color: '#888780', bg: '#f1efe8' };
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
    // Sold date (invoice date) desc, with invoice-less jobs sorted LAST.
    const da = a.invoice?.date ? new Date(a.invoice.date).getTime() : null;
    const db = b.invoice?.date ? new Date(b.invoice.date).getTime() : null;
    if (da === null && db === null) return 0;
    if (da === null) return 1;   // a has no date → after b
    if (db === null) return -1;  // b has no date → after a
    return db - da;              // both have dates → newest first
  });

  const totalPages = Math.ceil(filteredJobs.length / pageSize);
  const displayed = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const current = editingJob ? { ...editingJob, ...stageEdit } : null;

  if (status === 'loading') return null;

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Title */}
      <div style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Dispatcher</h1>
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, background: '#E1F5EE', color: '#085041', border: '0.5px solid #5DCAA5', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}

      {editingJob && current && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{editingJob.customer?.name}</div>
                <div style={{ fontSize: 12, color: '#888780' }}>Invoice #{editingJob.invoice?.externalId}</div>
              </div>
              <button onClick={() => { setEditingJob(null); setStageEdit({}); }} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>
                X
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {editingJob.hasExclusion && (
                <div style={{ padding: 12, background: '#F8F7F4', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#2C2C2A' }}>Exclusion</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="excDone" checked={!!current.exclusionDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, exclusionDone: e.target.checked }))} />
                    <label htmlFor="excDone" style={{ fontSize: 12 }}>Exclusion done</label>
                  </div>
                  {current.exclusionDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#888780', width: 80 }}>Date:</label>
                      <input type="date"
                        value={stageEdit.exclusionDate || (editingJob.exclusionDate ? editingJob.exclusionDate.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, exclusionDate: e.target.value }))}
                        style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4 }} />
                    </div>
                  )}
                </div>
              )}

              {editingJob.hasTrapping && (
                <div style={{ padding: 12, background: '#F8F7F4', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#2C2C2A' }}>Trapping</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="trapDone" checked={!!current.trapsDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, trapsDone: e.target.checked }))} />
                    <label htmlFor="trapDone" style={{ fontSize: 12 }}>Trapping done</label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: '#888780', width: 80 }}>Trap checks:</label>
                    <input type="number" min={0}
                      value={stageEdit.trapCheckCount || editingJob.trapCheckCount}
                      onChange={e => setStageEdit((p: any) => ({ ...p, trapCheckCount: Number(e.target.value) }))}
                      style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4, width: 60 }} />
                  </div>
                  {current.trapsDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#888780', width: 80 }}>Last check:</label>
                      <input type="date"
                        value={stageEdit.lastTrapCheck || (editingJob.lastTrapCheck ? editingJob.lastTrapCheck.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, lastTrapCheck: e.target.value }))}
                        style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4 }} />
                    </div>
                  )}
                </div>
              )}

              {editingJob.hasFAR && (
                <div style={{ padding: 12, background: '#F8F7F4', borderRadius: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#2C2C2A' }}>FAR</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <input type="checkbox" id="farDone" checked={!!current.farDone}
                      onChange={e => setStageEdit((p: any) => ({ ...p, farDone: e.target.checked }))} />
                    <label htmlFor="farDone" style={{ fontSize: 12 }}>FAR done</label>
                  </div>
                  {current.farDone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 11, color: '#888780', width: 80 }}>Date:</label>
                      <input type="date"
                        value={stageEdit.farDate || (editingJob.farDate ? editingJob.farDate.split('T')[0] : '')}
                        onChange={e => setStageEdit((p: any) => ({ ...p, farDate: e.target.value }))}
                        style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4 }} />
                    </div>
                  )}
                </div>
              )}

              <div style={{ padding: 12, background: '#F8F7F4', borderRadius: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 10, color: '#2C2C2A' }}>Close out</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="checkbox" id="closedOut" checked={!!current.closedOut}
                    onChange={e => setStageEdit((p: any) => ({ ...p, closedOut: e.target.checked }))} />
                  <label htmlFor="closedOut" style={{ fontSize: 12 }}>Closed out</label>
                </div>
                {current.closedOut && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 11, color: '#888780', width: 80 }}>Date:</label>
                    <input type="date"
                      value={stageEdit.closedOutDate || (editingJob.closedOutDate ? editingJob.closedOutDate.split('T')[0] : '')}
                      onChange={e => setStageEdit((p: any) => ({ ...p, closedOutDate: e.target.value }))}
                      style={{ fontSize: 12, padding: '3px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4 }} />
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditingJob(null); setStageEdit({}); }}
                style={{ padding: '6px 16px', fontSize: 12, borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveStage} disabled={savingStage}
                style={{ padding: '6px 16px', fontSize: 12, borderRadius: 6, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', opacity: savingStage ? 0.7 : 1 }}>
                {savingStage ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
            {OFFICES.map(o => (
              <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: office === o ? '#2C2C2A' : '#888780', background: office === o ? '#ffffff' : 'transparent', border: office === o ? '0.5px solid #D3D1C7' : '0.5px solid transparent', boxShadow: office === o ? '0 1px 3px rgba(44,44,42,0.08)' : 'none', cursor: 'pointer' }}>
                {o}
              </button>
            ))}
          </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888780' }}>Stage:</span>
            <select
              value={stageFilter}
              onChange={e => { setStageFilter(e.target.value); setCurrentPage(1); }}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 20, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer' }}
            >
              {STAGE_FILTERS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={customerSearch}
              onChange={e => { setCustomerSearch(e.target.value); setCurrentPage(1); }}
              placeholder="Search customer..."
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 20, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', width: 200 }}
            />
            {customerSearch && (
              <button
                onClick={() => { setCustomerSearch(''); setCurrentPage(1); }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <LastSynced office={office} />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Active jobs', value: kpis.total, filter: 'all', color: ACCENT },
            { label: 'Exclusion pending', value: kpis.exclusionPending, filter: 'exclusion_pending', color: '#A32D2D' },
            { label: 'Trap checks', value: kpis.trapChecks, filter: 'trap_checks', color: '#185FA5' },
            { label: 'FAR pending', value: kpis.farPending, filter: 'far_pending', color: '#854F0B' },
            { label: 'Needs attention', value: kpis.needsAttention, filter: 'needs_attention', color: '#BA7517' },
            { label: 'Closed this month', value: kpis.closedThisMonth, filter: 'closed_this_month', color: '#1D9E75' },
          ].map(tile => (
            <div
              key={tile.label}
              onClick={() => { setStageFilter(tile.filter); setCurrentPage(1); }}
              style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', cursor: 'pointer', border: '0.5px solid #E8E7E3', borderLeft: `3px solid ${tile.color}`, transition: 'box-shadow 0.15s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(44,44,42,0.08)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
            >
              <div style={{ fontSize: 11, color: '#888780', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{tile.label}</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: tile.color }}>{loading ? '...' : tile.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
              <tr style={{ background: '#F8F7F4' }}>
                {['', 'Customer', 'PM', 'Invoice', 'Sold date', 'Days since sold', 'Last update', 'Stage', 'Stages', 'Trap checks', 'Flags'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
              ) : displayed.map((job: any) => {
                const stage = getStage(job);
                const flags = getFlags(job);
                const daysSold = job.invoice?.date ? daysSince(job.invoice.date) : null;
                const daysUpdate = daysSince(job.updatedAt);
                return (
                  <tr key={job.id} style={{ borderBottom: '0.5px solid #F1EFE8', background: flags.length > 0 ? '#FFFBF5' : 'inherit' }}>
                    <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => { setEditingJob(job); setStageEdit({}); }}
                        style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#888780' }}
                      >
                        Edit
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 500, minWidth: 160 }}>
                      <div>{job.customer?.name || '\u2014'}</div>
                      <div style={{ fontSize: 11, color: '#888780' }}>{job.customer?.serviceAddr?.split(',')[0]}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#888780', whiteSpace: 'nowrap' }}>{job.pmName || '\u2014'}</td>
                    <td style={{ padding: '10px 12px', color: '#888780', whiteSpace: 'nowrap' }}>
                      <div>{job.invoice?.externalId || '\u2014'}</div>
                      <div style={{ fontSize: 11, color: '#1D9E75', fontWeight: 500 }}>{job.invoice?.amount ? fmt(job.invoice.amount) : '\u2014'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#888780', whiteSpace: 'nowrap' }}>{job.invoice?.date ? job.invoice.date.split('T')[0] : '\u2014'}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {daysSold !== null ? <span style={{ color: daysSold > 30 ? '#A32D2D' : '#2C2C2A', fontWeight: daysSold > 30 ? 500 : 400 }}>{daysSold}d</span> : '\u2014'}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {daysUpdate !== null ? <span style={{ color: daysUpdate > 7 ? '#BA7517' : '#888780' }}>{daysUpdate}d ago</span> : '\u2014'}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: stage.bg, color: stage.color }}>{stage.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {job.hasExclusion && <StageChip done={job.exclusionDone} label="Exclusion" date={job.exclusionDate} />}
                        {job.hasTrapping && <StageChip done={job.trapsDone} label="Trapping" date={job.lastTrapCheck} />}
                        {job.hasFAR && <StageChip done={job.farDone} label="FAR" date={job.farDate} />}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {job.hasTrapping ? (
                        <div>
                          <span style={{ fontWeight: 500, color: job.trapCheckCount >= 3 ? '#A32D2D' : '#2C2C2A' }}>{job.trapCheckCount}</span>
                          {job.lastTrapCheck && <div style={{ fontSize: 11, color: '#888780' }}>Last: {job.lastTrapCheck.split('T')[0]}</div>}
                        </div>
                      ) : <span style={{ color: '#B4B2A9' }}>{'\u2014'}</span>}
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 160 }}>
                      {flags.map(f => <AttentionFlag key={f} label={f} />)}
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredJobs.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>
                  {customerSearch ? `No jobs matching "${customerSearch}"` : 'No jobs found'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '0.5px solid #E8E7E3', background: '#F8F7F4', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#888780' }}>
            Showing {filteredJobs.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            {'\u2013'}
            {Math.min(currentPage * pageSize, filteredJobs.length)} of {filteredJobs.length} jobs
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12, padding: '2px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4, marginLeft: 8 }}>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select> per page
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #D3D1C7', borderRadius: 4, background: currentPage === 1 ? '#F8F7F4' : '#fff', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #D3D1C7', borderRadius: 4, background: currentPage === totalPages ? '#F8F7F4' : '#fff', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
