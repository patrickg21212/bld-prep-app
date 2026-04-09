import React, { useState } from 'react';
import type { AppProject } from '../lib/types';

interface Props {
  project: AppProject;
  initialJobNumber: string;
  initialJobName: string;
  onComplete: (jobNumber: string, jobName: string) => void;
}

export default function ProjectSettings({ project, initialJobNumber, initialJobName, onComplete }: Props) {
  const [jobNumber, setJobNumber] = useState(initialJobNumber);
  const [jobName, setJobName] = useState(initialJobName || project.name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete(jobNumber.trim(), jobName.trim());
  };

  return (
    <div className="max-w-lg mx-auto pt-4">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Project Settings
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Set job-level defaults. These will auto-fill on every prep sheet for this project.
        </p>
      </div>

      {/* File summary */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '14px 16px', marginBottom: 24,
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>LOADED FILE</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{project.fileName}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
          {project.segments.length} segments detected
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField
            label="JOB #"
            placeholder="e.g. 2024-NAS-001"
            value={jobNumber}
            onChange={setJobNumber}
            hint="Contract or work order number — appears on every prep sheet"
          />
          <FormField
            label="JOB NAME"
            placeholder="e.g. Nashville Annual Rehab — Phase 3"
            value={jobName}
            onChange={setJobName}
            hint="Project name — appears on every prep sheet"
          />
        </div>

        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
          <button
            type="submit"
            style={{
              background: 'var(--accent)', color: 'white', border: 'none',
              borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', flex: 1,
            }}>
            Continue to Segments →
          </button>
        </div>
      </form>
    </div>
  );
}

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}

function FormField({ label, placeholder, value, onChange, hint }: FormFieldProps) {
  return (
    <div>
      <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 14,
        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--bg-card)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
          fontSize: 15, outline: 'none', transition: 'border-color 0.15s',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
      {hint && <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>{hint}</p>}
    </div>
  );
}
