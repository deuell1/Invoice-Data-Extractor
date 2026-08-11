import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Zap,
  FileText,
  ArrowRight,
  RotateCcw,
  Keyboard,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Decision = 'accepted' | 'rejected' | 'edited' | null;

interface Field {
  id: string;
  label: string;
  extracted: string;
  suggestion: string;
  confidence: number; // 0–100
  reason: string;
  docSnippet: string; // text pulled from doc
  category: 'critical' | 'warning' | 'info';
}

// ── Data ─────────────────────────────────────────────────────────────────────

const FIELDS: Field[] = [
  {
    id: 'vendor',
    label: 'Vendor Name',
    extracted: 'ACME DISTRIB',
    suggestion: 'Acme Distribution Inc.',
    confidence: 42,
    reason: 'Extracted abbreviation doesn\'t match any known vendor record exactly.',
    docSnippet: '"Sold by: ACME DISTRIB · 482 Trade Blvd, Chicago IL"',
    category: 'critical',
  },
  {
    id: 'date',
    label: 'Invoice Date',
    extracted: '12/04/23',
    suggestion: 'December 4, 2023',
    confidence: 65,
    reason: 'Ambiguous format — could be MM/DD or DD/MM. Vendor history suggests MM/DD.',
    docSnippet: '"Invoice Date: 12/04/23  ·  Due: 30 days net"',
    category: 'warning',
  },
  {
    id: 'amount',
    label: 'Total Amount',
    extracted: '$4,250.00',
    suggestion: '$4,250.00',
    confidence: 98,
    reason: 'Matches line-item sum and PO expected value within tolerance.',
    docSnippet: '"TOTAL DUE: $4,250.00  (Tax incl.)"',
    category: 'info',
  },
  {
    id: 'po',
    label: 'PO Number',
    extracted: 'PO-99120',
    suggestion: 'PO-99120',
    confidence: 94,
    reason: 'Found in our open PO list. Amount matches within 2%.',
    docSnippet: '"Ref PO: PO-99120 · Dept: Operations"',
    category: 'info',
  },
];

const CATEGORY_META = {
  critical: { color: '#f78166', bg: 'rgba(247,129,102,0.12)', label: 'Needs Review' },
  warning:  { color: '#e3b341', bg: 'rgba(227,179,65,0.12)',  label: 'Verify' },
  info:     { color: '#3fb950', bg: 'rgba(63,185,80,0.12)',   label: 'Auto-Verified' },
};

// ── Confidence Ring ───────────────────────────────────────────────────────────

function ConfidenceRing({ value, color }: { value: number; color: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text
        x="36" y="36"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
        style={{ transform: 'rotate(90deg)', transformOrigin: '36px 36px' }}
      >
        {value}%
      </text>
    </svg>
  );
}

// ── Progress Dots ─────────────────────────────────────────────────────────────

function ProgressDots({
  total,
  current,
  decisions,
}: {
  total: number;
  current: number;
  decisions: Decision[];
}) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const d = decisions[i];
        const isActive = i === current;
        let bg = 'rgba(255,255,255,0.12)';
        if (d === 'accepted') bg = '#3fb950';
        else if (d === 'rejected') bg = '#f78166';
        else if (d === 'edited') bg = '#58a6ff';
        else if (isActive) bg = 'rgba(255,255,255,0.4)';
        return (
          <div
            key={i}
            style={{
              width: isActive ? 24 : 8,
              height: 8,
              borderRadius: 4,
              background: bg,
              transition: 'all 0.25s ease',
            }}
          />
        );
      })}
    </div>
  );
}

// ── KBD Hint ─────────────────────────────────────────────────────────────────

function KbdHint({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 4,
        padding: '2px 6px',
        color: 'rgba(255,255,255,0.5)',
        letterSpacing: '0.05em',
      }}>{hint}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
    </div>
  );
}

// ── Summary Screen ────────────────────────────────────────────────────────────

function SummaryScreen({
  decisions,
  fields,
  onReset,
}: {
  decisions: Decision[];
  fields: Field[];
  onReset: () => void;
}) {
  const accepted = decisions.filter(d => d === 'accepted' || d === 'info' as Decision).length;
  const reviewed = decisions.filter(d => d !== null).length;

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#090b11',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: '50%',
            background: 'rgba(63,185,80,0.15)',
            border: '1px solid rgba(63,185,80,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <CheckCircle2 size={24} color="#3fb950" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fafafa', margin: 0, marginBottom: 8 }}>
            Review Complete
          </h1>
          <p style={{ color: '#8b949e', fontSize: 13, margin: 0 }}>
            All {reviewed} fields reviewed · INV-2023-8991
          </p>
        </div>

        {/* Summary list */}
        <div style={{
          background: '#0e1017',
          border: '1px solid #242530',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {fields.map((field, i) => {
            const d = decisions[i];
            const meta = CATEGORY_META[field.category];
            return (
              <div key={field.id} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: i < fields.length - 1 ? '1px solid #242530' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 2 }}>{field.label}</div>
                  <div style={{ fontSize: 13, color: '#fafafa', fontWeight: 600 }}>
                    {d === 'rejected' ? field.extracted : field.suggestion}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {d === 'accepted' && <span style={{ fontSize: 11, color: '#3fb950', background: 'rgba(63,185,80,0.1)', padding: '2px 8px', borderRadius: 20 }}>Accepted</span>}
                  {d === 'rejected' && <span style={{ fontSize: 11, color: '#f78166', background: 'rgba(247,129,102,0.1)', padding: '2px 8px', borderRadius: 20 }}>Kept Original</span>}
                  {d === 'edited' && <span style={{ fontSize: 11, color: '#58a6ff', background: 'rgba(88,166,255,0.1)', padding: '2px 8px', borderRadius: 20 }}>Edited</span>}
                  {d === null && <span style={{ fontSize: 11, color: meta.color, background: meta.bg, padding: '2px 8px', borderRadius: 20 }}>Skipped</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onReset}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid #242530',
              borderRadius: 8,
              color: '#8b949e',
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <RotateCcw size={14} /> Start Over
          </button>
          <button
            style={{
              flex: 2,
              padding: '10px 16px',
              background: '#58a6ff',
              border: 'none',
              borderRadius: 8,
              color: '#090b11',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            Approve Invoice <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ExtractionTriageFlow() {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>(Array(FIELDS.length).fill(null));
  const [editValue, setEditValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [done, setDone] = useState(false);
  const [animDir, setAnimDir] = useState<'in' | 'out-left' | 'out-right'>('in');

  const field = FIELDS[currentIdx];
  const meta = field ? CATEGORY_META[field.category] : null;

  // Keyboard shortcuts
  const navigate = useCallback((dir: 'next' | 'prev') => {
    const next = dir === 'next' ? currentIdx + 1 : currentIdx - 1;
    if (next < 0 || next > FIELDS.length) return;
    setAnimDir(dir === 'next' ? 'out-left' : 'out-right');
    setTimeout(() => {
      if (next === FIELDS.length) {
        setDone(true);
      } else {
        setCurrentIdx(next);
        setIsEditing(false);
        setAnimDir('in');
      }
    }, 150);
  }, [currentIdx]);

  const decide = useCallback((d: Decision) => {
    setDecisions(prev => {
      const copy = [...prev];
      copy[currentIdx] = d;
      return copy;
    });
    navigate('next');
  }, [currentIdx, navigate]);

  useEffect(() => {
    if (isEditing || done) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
        decide('accepted');
      } else if (e.key === 'n' || e.key === 'N') {
        decide('rejected');
      } else if (e.key === 'e' || e.key === 'E') {
        setIsEditing(true);
        setEditValue(field?.suggestion ?? '');
      } else if (e.key === 'ArrowRight') {
        navigate('next');
      } else if (e.key === 'ArrowLeft') {
        navigate('prev');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isEditing, done, decide, navigate, field]);

  if (done) {
    return (
      <SummaryScreen
        decisions={decisions}
        fields={FIELDS}
        onReset={() => {
          setDecisions(Array(FIELDS.length).fill(null));
          setCurrentIdx(0);
          setDone(false);
          setIsEditing(false);
          setAnimDir('in');
        }}
      />
    );
  }

  const isAutoVerified = field.category === 'info';

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#090b11',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'JetBrains Mono', monospace",
      color: '#fafafa',
    }}>

      {/* ── Top bar ── */}
      <header style={{
        height: 52,
        borderBottom: '1px solid #242530',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: '#0e1017',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={14} color="#58a6ff" />
          <span style={{ fontSize: 12, color: '#8b949e' }}>Acme_Invoice_Nov.pdf</span>
          <span style={{
            fontSize: 10,
            color: '#8b949e',
            background: '#1a1d27',
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid #242530',
          }}>INV-2023-8991</span>
        </div>

        <ProgressDots total={FIELDS.length} current={currentIdx} decisions={decisions} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Keyboard size={12} color="#8b949e" />
          <span style={{ fontSize: 11, color: '#8b949e' }}>Keyboard mode</span>
        </div>
      </header>

      {/* ── Main card area ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 560,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          opacity: animDir === 'in' ? 1 : 0,
          transform: animDir === 'out-left' ? 'translateX(-40px)' : animDir === 'out-right' ? 'translateX(40px)' : 'translateX(0)',
          transition: 'opacity 0.15s ease, transform 0.15s ease',
        }}>

          {/* Step counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11,
                color: meta!.color,
                background: meta!.bg,
                padding: '3px 10px',
                borderRadius: 20,
                border: `1px solid ${meta!.color}33`,
              }}>{meta!.label}</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                Field {currentIdx + 1} of {FIELDS.length}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {decisions.filter(d => d !== null).length > 0 && (
                <span style={{ fontSize: 11, color: '#3fb950' }}>
                  {decisions.filter(d => d !== null).length} resolved
                </span>
              )}
            </div>
          </div>

          {/* Main triage card */}
          <div style={{
            background: '#0e1017',
            border: `1px solid ${isAutoVerified ? '#3fb95040' : meta!.color + '40'}`,
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: `0 0 40px ${meta!.color}10`,
          }}>

            {/* Field label bar */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #242530',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isAutoVerified
                  ? <CheckCircle2 size={14} color="#3fb950" />
                  : <AlertTriangle size={14} color={meta!.color} />
                }
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fafafa', letterSpacing: '0.03em' }}>
                  {field.label}
                </span>
              </div>
              <ConfidenceRing value={field.confidence} color={meta!.color} />
            </div>

            {/* Doc snippet */}
            <div style={{
              margin: '16px 20px',
              padding: '12px 14px',
              background: '#13161f',
              border: '1px solid #1a1d27',
              borderRadius: 8,
              borderLeft: `3px solid ${meta!.color}`,
            }}>
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Document source
              </div>
              <div style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.6 }}>
                {field.docSnippet}
              </div>
            </div>

            {/* Reason */}
            <div style={{ padding: '0 20px 16px' }}>
              <p style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.7, margin: 0 }}>
                {field.reason}
              </p>
            </div>

            {/* Extracted vs Suggestion */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 0,
              borderTop: '1px solid #242530',
            }}>
              <div style={{
                padding: '16px 20px',
                borderRight: '1px solid #242530',
              }}>
                <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Extracted
                </div>
                <div style={{
                  fontSize: 15,
                  color: isAutoVerified ? '#fafafa' : '#8b949e',
                  fontWeight: 600,
                  textDecoration: isAutoVerified ? 'none' : 'line-through',
                }}>
                  {field.extracted}
                </div>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 10, color: meta!.color, marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.8 }}>
                  {isAutoVerified ? 'Confirmed' : 'Suggestion'}
                </div>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        decide('edited');
                        setIsEditing(false);
                      } else if (e.key === 'Escape') {
                        setIsEditing(false);
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: `1px solid ${meta!.color}`,
                      color: '#fafafa',
                      fontSize: 15,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600,
                      width: '100%',
                      outline: 'none',
                      paddingBottom: 2,
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 15, color: '#fafafa', fontWeight: 600 }}>
                    {field.suggestion}
                  </div>
                )}
              </div>
            </div>

            {/* Action bar */}
            <div style={{
              borderTop: '1px solid #242530',
              padding: '14px 20px',
              display: 'flex',
              gap: 10,
            }}>
              {isEditing ? (
                <>
                  <button
                    onClick={() => { decide('edited'); setIsEditing(false); }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#58a6ff',
                      border: 'none',
                      borderRadius: 8,
                      color: '#090b11',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    Save Edit <span style={{ fontSize: 10, opacity: 0.7 }}>↵</span>
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    style={{
                      padding: '10px 14px',
                      background: 'transparent',
                      border: '1px solid #242530',
                      borderRadius: 8,
                      color: '#8b949e',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : isAutoVerified ? (
                <>
                  <button
                    onClick={() => decide('accepted')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: 'rgba(63,185,80,0.15)',
                      border: '1px solid rgba(63,185,80,0.3)',
                      borderRadius: 8,
                      color: '#3fb950',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <CheckCircle2 size={13} /> Confirm
                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6, background: 'rgba(63,185,80,0.2)', padding: '1px 5px', borderRadius: 3 }}>Y</span>
                  </button>
                  <button
                    onClick={() => { setIsEditing(true); setEditValue(field.suggestion); }}
                    style={{
                      padding: '10px 14px',
                      background: 'transparent',
                      border: '1px solid #242530',
                      borderRadius: 8,
                      color: '#8b949e',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <Edit3 size={12} /> Edit
                    <span style={{ fontSize: 10, opacity: 0.5, background: '#1a1d27', padding: '1px 5px', borderRadius: 3 }}>E</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => decide('accepted')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: `${meta!.color}22`,
                      border: `1px solid ${meta!.color}44`,
                      borderRadius: 8,
                      color: meta!.color,
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <CheckCircle2 size={13} /> Accept Suggestion
                    <span style={{ fontSize: 10, opacity: 0.6, background: `${meta!.color}33`, padding: '1px 5px', borderRadius: 3 }}>Y</span>
                  </button>
                  <button
                    onClick={() => decide('rejected')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: 'rgba(247,129,102,0.08)',
                      border: '1px solid rgba(247,129,102,0.25)',
                      borderRadius: 8,
                      color: '#f78166',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <XCircle size={13} /> Keep Original
                    <span style={{ fontSize: 10, opacity: 0.6, background: 'rgba(247,129,102,0.2)', padding: '1px 5px', borderRadius: 3 }}>N</span>
                  </button>
                  <button
                    onClick={() => { setIsEditing(true); setEditValue(field.suggestion); }}
                    style={{
                      padding: '10px 12px',
                      background: 'transparent',
                      border: '1px solid #242530',
                      borderRadius: 8,
                      color: '#8b949e',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Edit3 size={12} />
                    <span style={{ fontSize: 10, opacity: 0.5, background: '#1a1d27', padding: '1px 4px', borderRadius: 3 }}>E</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Navigation row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <button
              onClick={() => navigate('prev')}
              disabled={currentIdx === 0}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid #242530',
                borderRadius: 8,
                color: currentIdx === 0 ? '#3a3f4b' : '#8b949e',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: currentIdx === 0 ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <ChevronLeft size={14} /> Prev
            </button>

            {/* Keyboard hints */}
            <div style={{ display: 'flex', gap: 12 }}>
              {!isEditing && !isAutoVerified && (
                <>
                  <KbdHint label="accept" hint="Y / ↵" />
                  <KbdHint label="reject" hint="N" />
                  <KbdHint label="edit" hint="E" />
                </>
              )}
              {!isEditing && isAutoVerified && (
                <>
                  <KbdHint label="confirm" hint="Y" />
                  <KbdHint label="edit" hint="E" />
                </>
              )}
            </div>

            <button
              onClick={() => navigate('next')}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid #242530',
                borderRadius: 8,
                color: '#8b949e',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              Skip <ChevronRight size={14} />
            </button>
          </div>

          {/* AI hint strip */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            background: '#0e1017',
            border: '1px solid #1a1d27',
            borderRadius: 8,
          }}>
            <Zap size={12} color="#58a6ff" />
            <span style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>
              {currentIdx === 0
                ? 'Tip: press Y to accept the AI suggestion and move to the next field instantly.'
                : currentIdx === 1
                ? 'Tip: vendor history across 14 past invoices all used MM/DD format for this vendor.'
                : 'Tip: this field was auto-verified with high confidence. You can confirm or edit if needed.'}
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
