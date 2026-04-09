import React, { useState, useEffect } from 'react';
import type { SheetInfo } from '../lib/excel';

interface Props {
  sheets: SheetInfo[];
  onSelect: (sheetName: string) => void;
  onCancel: () => void;
}

export default function SheetPicker({ sheets, onSelect, onCancel }: Props) {
  const [selected, setSelected] = useState<string>('');

  // Auto-select the mainline tab if found
  useEffect(() => {
    const mainline = sheets.find(s => s.isLikelyMainline);
    if (mainline) {
      setSelected(mainline.name);
    }
  }, [sheets]);

  return (
    <div className="max-w-2xl mx-auto pt-4">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Select Sheet
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          This workbook has {sheets.length} tabs. Pick the one with your mainline tracking data.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
        {sheets.map(sheet => {
          const isActive = selected === sheet.name;
          return (
            <button
              key={sheet.name}
              onClick={() => setSelected(sheet.name)}
              style={{
                background: isActive ? 'var(--accent-subtle)' : 'var(--bg-card)',
                border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: isActive ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                borderRadius: 8,
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div>
                <div style={{
                  color: 'var(--text-primary)', fontWeight: 600, fontSize: 15,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {sheet.name}
                  {sheet.isLikelyMainline && (
                    <span style={{
                      background: 'rgba(63,185,80,0.15)', color: 'var(--success)',
                      borderRadius: 4, padding: '2px 8px', fontSize: 14, fontWeight: 700,
                    }}>
                      RECOMMENDED
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
                  {sheet.rowCount} rows, {sheet.colCount} columns
                </div>
              </div>
              {isActive && (
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={onCancel}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', borderRadius: 8, padding: '12px 24px',
            fontSize: 15, cursor: 'pointer',
          }}>
          Cancel
        </button>
        <button
          onClick={() => { if (selected) onSelect(selected); }}
          disabled={!selected}
          style={{
            background: selected ? 'var(--accent)' : 'var(--bg-card)',
            border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'),
            color: selected ? 'white' : 'var(--text-muted)',
            borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600,
            cursor: selected ? 'pointer' : 'not-allowed', flex: 1,
          }}>
          Use This Sheet &rarr;
        </button>
      </div>
    </div>
  );
}
