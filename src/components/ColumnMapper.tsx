import React, { useState } from 'react';
import type { PrepField } from '../lib/types';
import { PREP_FIELD_LABELS } from '../lib/types';
import { columnIndexToLetter } from '../lib/excel';

interface Props {
  headers: string[];
  confident: Partial<Record<PrepField, number>>;
  uncertain: Array<{ headerIndex: number; header: string; match: any }>;
  onComplete: (mapping: Record<PrepField, number | null>) => void;
}

const ALL_FIELDS: PrepField[] = [
  'repairNumber', 'date', 'pipeSize', 'pipeLength', 'streetName',
  'usDepth', 'dsDepth', 'mhFrom', 'mhTo', 'readyToLine',
  'comments1', 'comments2', 'pipeMaterial', 'sheetNumber',
];

const REQUIRED_FIELDS: PrepField[] = ['repairNumber', 'date', 'streetName'];

export default function ColumnMapper({ headers, confident, uncertain, onComplete }: Props) {
  const [mapping, setMapping] = useState<Record<PrepField, number | null>>(() => {
    const m: Record<PrepField, number | null> = {} as any;
    for (const f of ALL_FIELDS) {
      m[f] = confident[f] !== undefined ? confident[f]! : null;
    }
    return m;
  });

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const missing = REQUIRED_FIELDS.filter(f => mapping[f] === null || mapping[f] === undefined);
    if (missing.length > 0) {
      setError(`Required fields not mapped: ${missing.map(f => PREP_FIELD_LABELS[f]).join(', ')}`);
      return;
    }
    setError(null);
    onComplete(mapping);
  };

  const columnOptions = [
    { value: '', label: '— not mapped —' },
    ...headers.map((h, i) => ({ value: String(i), label: `Col ${columnIndexToLetter(i)}: ${h || '(empty)'}` })),
  ];

  const confidentFields = ALL_FIELDS.filter(f => confident[f] !== undefined);
  const manualFields = ALL_FIELDS.filter(f => confident[f] === undefined);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Column Mapping
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          We detected your spreadsheet columns. Review the auto-matched fields and fill in any missing ones.
          This mapping will be saved automatically for future uploads with the same format.
        </p>
      </div>

      {/* Confident matches */}
      {confidentFields.length > 0 && (
        <div className="mb-6">
          <div style={{
            background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.25)',
            borderRadius: 8, padding: '12px 16px', marginBottom: 12,
          }}>
            <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 14 }}>
              {confidentFields.length} fields auto-detected
            </span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {confidentFields.map(field => (
              <FieldRow
                key={field}
                field={field}
                value={mapping[field]}
                options={columnOptions}
                autoDetected
                onChange={(val) => setMapping(m => ({ ...m, [field]: val }))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manual mapping needed */}
      {manualFields.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ color: 'var(--text-muted)' }}>
            Manual Mapping Required
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {manualFields.map(field => (
              <FieldRow
                key={field}
                field={field}
                value={mapping[field]}
                options={columnOptions}
                required={REQUIRED_FIELDS.includes(field)}
                onChange={(val) => setMapping(m => ({ ...m, [field]: val }))}
              />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.4)',
          color: 'var(--danger)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        style={{
          background: 'var(--accent)', color: 'white', border: 'none',
          borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600,
          cursor: 'pointer', width: '100%',
        }}>
        Save Mapping & Continue →
      </button>
    </div>
  );
}

interface FieldRowProps {
  field: PrepField;
  value: number | null | undefined;
  options: { value: string; label: string }[];
  autoDetected?: boolean;
  required?: boolean;
  onChange: (val: number | null) => void;
}

function FieldRow({ field, value, options, autoDetected, required, onChange }: FieldRowProps) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>
            {PREP_FIELD_LABELS[field]}
          </span>
          {required && (
            <span style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 700 }}>REQUIRED</span>
          )}
          {autoDetected && (
            <span style={{ color: 'var(--success)', fontSize: 14, fontWeight: 600 }}>AUTO</span>
          )}
        </div>
      </div>
      <select
        value={value !== null && value !== undefined ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{
          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
          fontSize: 14, minWidth: 200, cursor: 'pointer',
        }}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
