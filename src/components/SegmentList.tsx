import React, { useMemo, useState } from 'react';
import type { AppProject, SegmentObservations, AnnotationData } from '../lib/types';
import { getWeekRanges } from '../lib/excel';

interface MapState {
  imageDataUrl: string | null;
  annotations: AnnotationData[];
}

interface Props {
  project: AppProject;
  jobNumber: string;
  jobName: string;
  observations: Record<string, SegmentObservations>;
  mapData: Record<string, MapState>;
  dateFilter: { start: Date | null; end: Date | null };
  selectedSegments: Set<string>;
  onDateFilterChange: (df: { start: Date | null; end: Date | null }) => void;
  onSegmentSelect: (index: number) => void;
  onSelectionChange: (sel: Set<string>) => void;
  onEditSettings: () => void;
  onBatchExport: () => void;
}

export default function SegmentList({
  project,
  jobNumber,
  jobName,
  observations,
  mapData,
  dateFilter,
  selectedSegments,
  onDateFilterChange,
  onSegmentSelect,
  onSelectionChange,
  onEditSettings,
  onBatchExport,
}: Props) {
  const weekRanges = useMemo(() => getWeekRanges(project.segments), [project]);
  const [selectedWeek, setSelectedWeek] = useState<string>('');
  const [search, setSearch] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);

  const filteredSegments = useMemo(() => {
    return project.segments
      .map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => {
        if (dateFilter.start && dateFilter.end && seg.date) {
          if (seg.date < dateFilter.start || seg.date > dateFilter.end) return false;
        }
        if (search) {
          const q = search.toLowerCase();
          return (
            seg.repairNumber.toLowerCase().includes(q) ||
            seg.streetName.toLowerCase().includes(q) ||
            seg.mhFrom.toLowerCase().includes(q) ||
            seg.mhTo.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [project.segments, dateFilter, search]);

  const handleWeekSelect = (weekLabel: string) => {
    setSelectedWeek(weekLabel);
    if (!weekLabel) {
      onDateFilterChange({ start: null, end: null });
      return;
    }
    const week = weekRanges.find(w => w.label === weekLabel);
    if (week) {
      onDateFilterChange({ start: week.start, end: week.end });
    }
  };

  const toggleSegment = (repairNumber: string) => {
    const next = new Set(selectedSegments);
    if (next.has(repairNumber)) next.delete(repairNumber);
    else next.add(repairNumber);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (selectedSegments.size === filteredSegments.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(filteredSegments.map(({ seg }) => seg.repairNumber)));
    }
  };

  const completedCount = project.segments.filter(
    s => observations[s.repairNumber]
  ).length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
            Segments
          </h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {jobNumber && <span>Job #{jobNumber} &middot; </span>}
            {jobName && <span>{jobName} &middot; </span>}
            <span>{project.segments.length} total &middot; {completedCount} edited</span>
          </div>
        </div>
        <button
          onClick={onEditSettings}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 14px',
            fontSize: 14, cursor: 'pointer',
          }}>
          Edit Settings
        </button>
      </div>

      {/* Instructional banner */}
      <div style={{
        background: 'var(--accent-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>
          Click <strong>Edit</strong> to fill in a segment. Use <strong>checkboxes</strong> to select segments for batch export.
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '14px 16px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 4, height: 8 }}>
          <div style={{
            background: 'var(--success)', height: 8, borderRadius: 4,
            width: `${project.segments.length ? (completedCount / project.segments.length) * 100 : 0}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14, whiteSpace: 'nowrap' }}>
          {completedCount} / {project.segments.length} edited
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          value={selectedWeek}
          onChange={e => handleWeekSelect(e.target.value)}
          style={{
            background: 'var(--bg-card)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
            fontSize: 14, cursor: 'pointer', minWidth: 220,
          }}>
          <option value="">All dates</option>
          {weekRanges.map(w => (
            <option key={w.label} value={w.label}>{w.label}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search repair #, street, MH..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, background: 'var(--bg-card)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px',
            fontSize: 14, outline: 'none',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* Segment table */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
        boxShadow: 'var(--shadow-md)',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 1fr 120px 70px 90px 80px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          padding: '10px 16px', gap: 12,
          alignItems: 'center',
        }}>
          <input
            type="checkbox"
            checked={filteredSegments.length > 0 && selectedSegments.size === filteredSegments.length}
            onChange={toggleAll}
            style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
            title="Select all for export"
          />
          <ColHeader>REPAIR #</ColHeader>
          <ColHeader>STREET</ColHeader>
          <ColHeader>DATE</ColHeader>
          <ColHeader>SIZE</ColHeader>
          <ColHeader>STATUS</ColHeader>
          <ColHeader style={{ textAlign: 'right' }}>ACTION</ColHeader>
        </div>

        {/* Rows */}
        {filteredSegments.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No segments match your filters.
          </div>
        ) : (
          filteredSegments.map(({ seg, idx }) => {
            const hasObs = !!observations[seg.repairNumber];
            const isSelected = selectedSegments.has(seg.repairNumber);
            return (
              <div
                key={seg.repairNumber}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr 1fr 120px 70px 90px 80px',
                  padding: '12px 16px', gap: 12,
                  borderBottom: '1px solid var(--border)',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                  background: isSelected ? 'rgba(47,129,247,0.04)' : 'transparent',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(47,129,247,0.04)' : 'transparent'; }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSegment(seg.repairNumber)}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                  title="Select for batch export"
                />
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
                    {seg.repairNumber}
                  </span>
                  {seg.mhFrom && seg.mhTo && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>
                      {seg.mhFrom} &rarr; {seg.mhTo}
                    </span>
                  )}
                </div>
                <div style={{
                  color: 'var(--text-primary)', fontSize: 14, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {seg.streetName || '\u2014'}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  {seg.dateStr || '\u2014'}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  {seg.pipeSize || '\u2014'}
                </div>
                <div>
                  {hasObs ? (
                    <Badge color="success">Edited</Badge>
                  ) : (
                    <Badge color="muted">Pending</Badge>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => onSegmentSelect(idx)}
                    style={{
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 5,
                      padding: '5px 14px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'var(--accent-hover)'; }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'var(--accent)'; }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {filteredSegments.length > 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12, textAlign: 'right' }}>
          Showing {filteredSegments.length} of {project.segments.length} segments
        </div>
      )}

      {/* Batch Export Section */}
      <div style={{
        marginTop: 24,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}>
        {/* Collapsible header */}
        <button
          onClick={() => setBatchOpen(!batchOpen)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'none',
            border: 'none',
            padding: '14px 16px',
            cursor: 'pointer',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Batch Export</span>
            {selectedSegments.size > 0 && (
              <span style={{
                background: 'rgba(47,129,247,0.15)', color: 'var(--accent)',
                borderRadius: 10, padding: '1px 8px', fontSize: 14, fontWeight: 600,
              }}>
                {selectedSegments.size} selected
              </span>
            )}
          </div>
          <span style={{
            color: 'var(--text-muted)', fontSize: 14,
            transition: 'transform 0.2s',
            transform: batchOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>

        {/* Collapsible body */}
        {batchOpen && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 14 }}>
              Select segments below, then export them as a combined PDF or ZIP of individual files.
            </p>

            {/* Select controls */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
            }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={filteredSegments.length > 0 && selectedSegments.size === filteredSegments.length}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                Select all ({filteredSegments.length})
              </label>
              {selectedSegments.size > 0 && (
                <button
                  onClick={() => onSelectionChange(new Set())}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', fontSize: 14,
                    cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  Clear selection
                </button>
              )}
            </div>

            {/* Segment chip list for batch selection */}
            <div style={{
              maxHeight: 200, overflowY: 'auto',
              display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16,
              padding: '10px 12px',
              background: 'var(--bg-secondary)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}>
              {filteredSegments.map(({ seg }) => {
                const isSelected = selectedSegments.has(seg.repairNumber);
                const hasObs = !!observations[seg.repairNumber];
                return (
                  <button
                    key={seg.repairNumber}
                    onClick={() => toggleSegment(seg.repairNumber)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: isSelected ? 'rgba(47,129,247,0.15)' : 'var(--bg-card)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                      borderRadius: 4, padding: '4px 10px',
                      fontSize: 14, fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.1s',
                    }}
                  >
                    {hasObs && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block', flexShrink: 0 }} />
                    )}
                    {seg.repairNumber}
                  </button>
                );
              })}
            </div>

            {/* Export button */}
            <button
              onClick={onBatchExport}
              disabled={selectedSegments.size === 0}
              style={{
                background: 'transparent',
                border: `1px solid ${selectedSegments.size > 0 ? 'var(--accent)' : 'var(--border)'}`,
                color: selectedSegments.size > 0 ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 6, padding: '8px 20px',
                fontSize: 14, fontWeight: 600,
                cursor: selectedSegments.size > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (selectedSegments.size > 0) {
                  (e.target as HTMLButtonElement).style.background = 'rgba(47,129,247,0.1)';
                }
              }}
              onMouseLeave={e => {
                (e.target as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              Export {selectedSegments.size > 0 ? `${selectedSegments.size} ` : ''}PDF{selectedSegments.size !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ColHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      color: 'var(--text-muted)', fontSize: 14, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      ...style,
    }}>
      {children}
    </span>
  );
}

function Badge({ color, children }: { color: 'success' | 'muted'; children: React.ReactNode }) {
  const colors = {
    success: { bg: 'rgba(63,185,80,0.15)', text: 'var(--success)' },
    muted: { bg: 'var(--bg-tertiary)', text: 'var(--text-muted)' },
  };
  return (
    <span style={{
      background: colors[color].bg, color: colors[color].text,
      borderRadius: 4, padding: '2px 8px', fontSize: 14, fontWeight: 600,
    }}>
      {children}
    </span>
  );
}
