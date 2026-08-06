import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';
import { Separator } from '../../components/ui/separator';

// ── Smooth cubic-bezier path helper ──────────────────────────────────────────
function smoothPath(pts: string): string {
  const parsed = pts.trim().split(/\s+/).map(p => {
    const [x, y] = p.split(',').map(Number);
    return [x, y] as [number, number];
  });
  if (parsed.length === 0) return '';
  let d = `M${parsed[0][0]},${parsed[0][1]}`;
  for (let i = 1; i < parsed.length; i++) {
    const [x0, y0] = parsed[i - 1];
    const [x1, y1] = parsed[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

function smoothArea(pts: string): string {
  const parsed = pts.trim().split(/\s+/).map(p => {
    const [x, y] = p.split(',').map(Number);
    return [x, y] as [number, number];
  });
  if (parsed.length === 0) return '';
  let d = `M${parsed[0][0]},100 L${parsed[0][0]},${parsed[0][1]}`;
  for (let i = 1; i < parsed.length; i++) {
    const [x0, y0] = parsed[i - 1];
    const [x1, y1] = parsed[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  const last = parsed[parsed.length - 1];
  d += ` L${last[0]},100 Z`;
  return d;
}

// ── Bento Cell ────────────────────────────────────────────────────────────────
function BentoCell({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative bg-card rounded-2xl border border-border p-4 flex flex-col overflow-hidden ${className}`}
    >
      <div className="absolute top-3 left-4 font-mono font-bold text-[10px] text-muted-foreground z-10 tracking-wider">
        {label}
      </div>
      <div className="flex-1 min-h-0 mt-5 relative w-full">{children}</div>
    </div>
  );
}

// ── Mini sparkline (system metrics) ──────────────────────────────────────────
function MiniSparkline() {
  const pts1 = '0,80 10,72 20,58 30,65 40,38 50,44 60,28 70,34 80,18 90,28 100,8';
  const pts2 = '0,60 10,52 20,38 30,50 40,24 50,42 60,18 70,32 80,14 90,26 100,4';
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex gap-3 text-[10px] font-bold font-mono text-muted-foreground mb-1 self-end">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-primary" /> CPU
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-chart-3" /> MEM
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id="mc-g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="mc-g2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map(y => (
            <line key={y} x1="0" y1={y} x2="100" y2={y}
              stroke="var(--color-border)" strokeWidth="0.4" strokeDasharray="2,3" />
          ))}
          <path d={smoothArea(pts1)} fill="url(#mc-g1)" />
          <path d={smoothArea(pts2)} fill="url(#mc-g2)" />
          <path d={smoothPath(pts1)} fill="none" stroke="var(--color-primary)" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            style={{ strokeDasharray: 350, strokeDashoffset: 350, animation: 'draw 1.4s ease-out forwards' }} />
          <path d={smoothPath(pts2)} fill="none" stroke="var(--color-chart-3)" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            style={{ strokeDasharray: 350, strokeDashoffset: 350, animation: 'draw 1.4s ease-out 0.2s forwards' }} />
        </svg>
      </div>
    </div>
  );
}

// ── KPI stat ──────────────────────────────────────────────────────────────────
function KpiStat({ value, label, color = 'text-accent' }: { value: string; label: string; color?: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
      <span className={`font-mono font-black text-3xl tabular-nums ${color}`}>{value}</span>
      <span className="font-mono font-bold text-[10px] text-muted-foreground tracking-widest uppercase">{label}</span>
    </div>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function MiniHeatmap() {
  const COLS = 10, ROWS = 5;
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => {
    const v = (Math.sin(i * 1.5) * Math.cos(i * 3.2) + 1) / 2;
    return v > 0.8 ? 4 : v > 0.6 ? 3 : v > 0.4 ? 2 : v > 0.2 ? 1 : 0;
  });
  const alphas = ['transparent', '0.15', '0.35', '0.60', '1'];
  return (
    <div className="w-full h-full grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
      {cells.map((v, i) => (
        <div key={i} className="rounded-[2px]"
          style={{
            backgroundColor: v === 0 ? 'transparent' : `color-mix(in srgb, var(--color-accent) ${Number(alphas[v]) * 100}%, transparent)`,
            border: v === 0 ? '1px solid var(--color-border)' : 'none',
          }} />
      ))}
    </div>
  );
}

// ── Build pipeline mini ───────────────────────────────────────────────────────
function MiniPipeline() {
  const stages = [
    { name: 'Lint',   pct: 14, done: true  },
    { name: 'Test',   pct: 22, done: true  },
    { name: 'Build',  pct: 22, done: true  },
    { name: 'Deploy', pct: 22, done: false },
    { name: 'Verify', pct: 20, done: false },
  ];
  return (
    <div className="w-full h-full flex flex-col justify-center gap-2">
      <div className="flex items-center gap-1 h-8">
        {stages.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1" style={{ flex: s.pct }}>
            {i > 0 && (
              <svg viewBox="0 0 8 8" className="w-2 h-2 shrink-0">
                <path d="M1,4 L7,4 M5,2 L7,4 L5,6" fill="none"
                  stroke={s.done ? 'var(--color-accent)' : 'var(--color-border)'}
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <div className="flex-1 h-full rounded flex items-center justify-center text-[8px] font-mono font-bold"
              style={{
                background: s.done
                  ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                  : 'color-mix(in srgb, var(--color-border) 30%, transparent)',
                border: `1px solid ${s.done ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border)'}`,
                color: s.done ? 'var(--color-accent)' : 'var(--color-muted-foreground)',
              }}>
              {s.done ? '✓' : '○'} {s.name}
            </div>
          </div>
        ))}
      </div>
      <Progress value={60} className="h-1" />
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
        <span>build #4821</span>
        <span className="text-primary animate-pulse">deploying…</span>
      </div>
    </div>
  );
}

// ── Applied example: Mission Control Bento ───────────────────────────────────
export function BentoDashboardDemo() {
  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2 text-primary font-black text-sm tracking-tight font-mono">
          <span>◈</span> mission_control
        </div>
        <div className="flex items-center gap-2 text-xs font-bold font-mono">
          <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/10">
            ENV: PROD
          </Badge>
          <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10">
            BUILD: #4821
          </Badge>
          <Badge variant="outline" className="text-accent border-accent/40 bg-accent/10 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block" />
            STATUS: NOMINAL
          </Badge>
        </div>
      </div>

      {/* Bento grid */}
      <div className="grid grid-cols-4 grid-rows-2 gap-2.5" style={{ height: 340 }}>
        <BentoCell className="col-span-2" label="// system_metrics">
          <MiniSparkline />
        </BentoCell>

        <BentoCell label="## uptime">
          <KpiStat value="99.97%" label="30-day SLA" color="text-accent" />
        </BentoCell>

        <BentoCell label="// commit_activity">
          <MiniHeatmap />
        </BentoCell>

        <BentoCell label="// error_rate">
          <div className="w-full h-full flex flex-col justify-center gap-2">
            {[
              { code: '200', pct: 85, color: 'var(--color-accent)' },
              { code: '4xx', pct: 10, color: 'var(--color-chart-3)' },
              { code: '5xx', pct:  5, color: 'var(--color-destructive)' },
            ].map(row => (
              <div key={row.code} className="flex items-center gap-2 text-[10px] font-mono font-bold">
                <span className="w-6 text-muted-foreground text-right shrink-0">{row.code}</span>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} />
                </div>
                <span style={{ color: row.color }}>{row.pct}%</span>
              </div>
            ))}
          </div>
        </BentoCell>

        <BentoCell className="col-span-2" label="## build_pipeline">
          <MiniPipeline />
        </BentoCell>

        <BentoCell label="// active_nodes">
          <div className="w-full h-full flex flex-col gap-1.5 justify-center">
            {[
              { id: '42', status: 'ok'   },
              { id: '43', status: 'ok'   },
              { id: '44', status: 'sync' },
              { id: '45', status: 'ok'   },
              { id: '46', status: 'err'  },
              { id: '47', status: 'ok'   },
            ].map(n => {
              const color = n.status === 'ok' ? 'var(--color-accent)'
                : n.status === 'sync' ? 'var(--color-primary)'
                : 'var(--color-destructive)';
              return (
                <div key={n.id} className="flex items-center gap-2 text-[10px] font-mono font-bold">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span style={{ color }}>node_{n.id}</span>
                  <span className="text-muted-foreground ml-auto">{n.status}</span>
                </div>
              );
            })}
          </div>
        </BentoCell>
      </div>

      <Separator />

      {/* Usage guidance */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Design guidelines
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-mono font-bold text-accent">✓ Do</p>
            <ul className="space-y-1 text-sm text-muted-foreground font-mono">
              <li>Use monospace for all text — headers, labels, values, code.</li>
              <li>Apply glowing neon accents sparingly: primary blue for active, accent green for healthy, destructive orange for errors.</li>
              <li>Use the bento grid pattern for dense multi-metric dashboards.</li>
              <li>Prefix cell labels with <code className="text-primary">// comment</code> or <code className="text-primary">## heading</code> syntax.</li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-mono font-bold text-destructive">✗ Don't</p>
            <ul className="space-y-1 text-sm text-muted-foreground font-mono">
              <li>Don't mix sans-serif typography — this system is mono-only.</li>
              <li>Don't use rounded corners larger than rounded-2xl on cell containers.</li>
              <li>Don't use more than five chart colors in one visualization.</li>
              <li>Don't use a light background for the bento grid — the dark surface is essential to the glow effects.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Component stripe */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Core components in this palette
        </h3>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm">Deploy</Button>
          <Button size="sm" variant="secondary">Rollback</Button>
          <Button size="sm" variant="outline">Inspect</Button>
          <Button size="sm" variant="ghost">Dismiss</Button>
          <Badge>nominal</Badge>
          <Badge variant="secondary">syncing</Badge>
          <Badge variant="outline">pending</Badge>
          <Badge variant="destructive">exception</Badge>
        </div>
      </div>

      <style>{`@keyframes draw { to { stroke-dashoffset: 0; } }`}</style>
    </div>
  );
}
