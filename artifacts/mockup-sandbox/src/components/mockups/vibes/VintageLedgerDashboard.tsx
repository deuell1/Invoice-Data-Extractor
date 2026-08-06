import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  FileText, 
  AlertCircle, 
  CheckSquare, 
  Users, 
  LayoutDashboard,
  Files,
  Upload,
  Download,
  History,
  Settings,
  FilePlus,
  LogOut,
  User,
  ShieldCheck,
  Search,
  Filter,
  ArrowRight,
  TrendingUp
} from "lucide-react";
import "./VintageLedgerDashboard.css";

// MOCK DATA
const mockMetrics = {
  total: 1248,
  exception: 84,
  pendingApproval: 312,
  approved: 640,
  posted: 212,
  pendingExtraction: 45,
  exportReady: 156,
  exported: 840,
  exportFailed: 12,
  exportBlocked: 8,
  needsReview: 142,
  tieOutFail: 36,
  tieOutWarning: 52,
  duplicateWarning: 18,
  missingPo: 64,
  missingDueDate: 112,
  avgExtractionConfidence: 94.2,
  avgVendorMatchConfidence: 98.1,
  exceptionRate: 6.7,
  totalApprovedAmount: 8452300,
  valueByStatus: [
    { status: "PENDING_EXTRACTION", count: 45, totalAmount: 125400 },
    { status: "EXCEPTION", count: 84, totalAmount: 342100 },
    { status: "PENDING_APPROVAL", count: 312, totalAmount: 1845000 },
    { status: "APPROVED", count: 640, totalAmount: 4210500 },
    { status: "POSTED", count: 212, totalAmount: 1929300 },
  ]
};

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Intake", href: "/invoices/new", icon: FilePlus },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Sources", href: "/sources", icon: Files },
  { name: "Exceptions", href: "/exceptions", icon: AlertCircle },
  { name: "Approvals", href: "/approvals", icon: CheckSquare },
  { name: "Vendors", href: "/vendors", icon: Users },
  { name: "Imports", href: "/imports", icon: Upload },
  { name: "Exports", href: "/exports", icon: Download },
  { name: "Audit", href: "/audit", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: amount >= 1000000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1000000 ? 1 : 0,
  }).format(amount);
}

function StatPanel({ 
  title, 
  value, 
  colorClass = "",
  label,
  trend
}: { 
  title: string; 
  value: React.ReactNode; 
  colorClass?: string;
  label?: string;
  trend?: string;
}) {
  return (
    <div className="ledger-panel flex flex-col justify-between group">
      <div>
        <div className="stat-title">{title}</div>
        <div className={`stat-value ${colorClass}`}>{value}</div>
      </div>
      {(label || trend) && (
        <div className="mt-4 flex items-center justify-between text-xs font-sans text-[var(--ledger-ink-light)] border-t border-dashed border-[var(--ledger-border-light)] pt-2">
          <span>{label}</span>
          {trend && <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {trend}</span>}
        </div>
      )}
    </div>
  );
}

export default function VintageLedgerDashboard() {
  const [dateFrom, setDateFrom] = useState("2024-01-01");
  const [dateTo, setDateTo] = useState("2024-12-31");
  const [status, setStatus] = useState("ALL");
  const [vendor, setVendor] = useState("ALL");
  
  // Layout wrapper inside the component
  return (
    <div className="vintage-ledger flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="ledger-sidebar flex flex-col w-64 shrink-0 z-10 shadow-[4px_0_24px_rgba(43,41,38,0.05)]">
        <div className="h-16 flex items-center px-6 border-b-2 border-[var(--ledger-border)] shrink-0 bg-[var(--ledger-paper-bright)]">
          <div className="text-xl font-bold italic tracking-tight">
            Vanguard Ledger
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4">
          <div className="text-xs font-sans uppercase tracking-widest text-[var(--ledger-ink-light)] mb-4 px-2">Index</div>
          <nav className="space-y-1">
            {navigation.map((item) => {
              const isActive = item.name === "Dashboard";
              return (
                <button 
                  key={item.name} 
                  data-active={isActive}
                  className="ledger-nav-link flex w-full items-center gap-3 px-3 py-2 rounded-sm text-sm"
                >
                  <item.icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={isActive ? 2.5 : 1.5} />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-[var(--ledger-border)] shrink-0 bg-[var(--ledger-paper-bright)]">
          <div className="flex items-center gap-3 px-2">
            <div className="h-8 w-8 rounded-full border border-[var(--ledger-border)] flex items-center justify-center shrink-0 bg-[var(--ledger-bg)]">
              <User className="h-4 w-4" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate font-sans">A. Hamilton</span>
              <div className="flex items-center gap-1 mt-0.5">
                <ShieldCheck className="h-3 w-3 text-[var(--ledger-green)] shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-[var(--ledger-green)] font-bold">
                  Chief Clerk
                </span>
              </div>
            </div>
            <button className="text-[var(--ledger-ink-light)] hover:text-[var(--ledger-ink)]">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="ledger-header h-16 flex items-center justify-between px-8 shrink-0 z-0">
          <h1 className="text-2xl font-normal italic">General Dashboard</h1>
          <div className="text-sm font-mono text-[var(--ledger-ink-light)] flex items-center gap-2">
            Vol. XLII <span className="mx-2 text-[var(--ledger-border-light)]">|</span> Folio 84
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-8 relative">
          <div className="max-w-6xl mx-auto space-y-12 pb-12">
            
            {/* Filters Section */}
            <section>
              <div className="flex items-end gap-6 pb-4 border-b-2 border-[var(--ledger-border)]">
                <div className="flex items-center gap-2 font-serif italic text-lg mr-4">
                  <Filter className="h-5 w-5" />
                  Parameters
                </div>
                
                <div className="flex-1 flex gap-6">
                  <div className="flex flex-col gap-1 w-40">
                    <label className="ledger-input-label">From Date</label>
                    <input 
                      type="date" 
                      className="ledger-input h-8" 
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-40">
                    <label className="ledger-input-label">To Date</label>
                    <input 
                      type="date" 
                      className="ledger-input h-8" 
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-48">
                    <label className="ledger-input-label">Status</label>
                    <select 
                      className="ledger-input h-8 appearance-none" 
                      value={status}
                      onChange={e => setStatus(e.target.value)}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PENDING">Pending</option>
                      <option value="APPROVED">Approved</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 w-48">
                    <label className="ledger-input-label">Vendor</label>
                    <select 
                      className="ledger-input h-8 appearance-none" 
                      value={vendor}
                      onChange={e => setVendor(e.target.value)}
                    >
                      <option value="ALL">All Vendors</option>
                      <option value="ACME">Acme Corp</option>
                      <option value="GLOBEX">Globex</option>
                    </select>
                  </div>
                </div>
                
                <button className="h-8 px-4 border border-[var(--ledger-border)] font-sans text-xs uppercase tracking-widest font-medium hover:bg-[var(--ledger-ink)] hover:text-[var(--ledger-bg)] transition-colors">
                  Query
                </button>
              </div>
            </section>

            {/* Phase 1 Summary */}
            <section>
              <h2 className="font-serif italic text-xl mb-4">Volume Overview</h2>
              <div className="grid gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                <StatPanel title="Total Invoices" value={mockMetrics.total} label="Period to date" trend="+12%" />
                <StatPanel title="Exceptions" value={mockMetrics.exception} colorClass="text-red" label="Requires action" trend="+2%" />
                <StatPanel title="Pending Appr." value={mockMetrics.pendingApproval} colorClass="text-gold" label="In queues" />
                <StatPanel title="Approved" value={mockMetrics.approved} colorClass="text-green" label="Ready to post" />
                <StatPanel title="Posted" value={mockMetrics.posted} colorClass="text-blue" label="Sync complete" />
                <StatPanel title="Extraction" value={mockMetrics.pendingExtraction} label="Processing" />
              </div>
            </section>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Quality Metrics */}
              <section>
                <h2 className="font-serif italic text-xl mb-4">Quality & Confidence</h2>
                <div className="grid gap-6 grid-cols-2">
                  <StatPanel 
                    title="Extraction Conf." 
                    value={`${mockMetrics.avgExtractionConfidence}%`} 
                    colorClass="text-blue" 
                  />
                  <StatPanel 
                    title="Vendor Match" 
                    value={`${mockMetrics.avgVendorMatchConfidence}%`} 
                    colorClass="text-blue" 
                  />
                  <StatPanel 
                    title="Exception Rate" 
                    value={`${mockMetrics.exceptionRate}%`} 
                    colorClass="text-red" 
                  />
                  <StatPanel 
                    title="Approved Value" 
                    value={formatCurrency(mockMetrics.totalApprovedAmount)} 
                    colorClass="text-green" 
                  />
                </div>
              </section>

              {/* Data Quality Warnings */}
              <section>
                <h2 className="font-serif italic text-xl mb-4">Quality Flags</h2>
                <div className="grid gap-6 grid-cols-2 lg:grid-cols-3">
                  <StatPanel title="Needs Review" value={mockMetrics.needsReview} colorClass="text-gold" />
                  <StatPanel title="Tie-Out Fail" value={mockMetrics.tieOutFail} colorClass="text-red" />
                  <StatPanel title="Tie-Out Warn" value={mockMetrics.tieOutWarning} colorClass="text-gold" />
                  <StatPanel title="Dup. Warning" value={mockMetrics.duplicateWarning} colorClass="text-gold" />
                  <StatPanel title="Missing PO" value={mockMetrics.missingPo} />
                  <StatPanel title="Missing Date" value={mockMetrics.missingDueDate} />
                </div>
              </section>
            </div>

            {/* Value by Status Table */}
            <section className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif italic text-xl">Value Distribution by Status</h2>
                <div className="text-xs font-sans text-[var(--ledger-ink-light)] uppercase tracking-wider">Fig. 1</div>
              </div>
              <div className="bg-[var(--ledger-paper-bright)] border-2 border-[var(--ledger-border)] p-1">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th className="w-1/4">Status Classification</th>
                      <th className="text-right w-1/6">Record Count</th>
                      <th className="text-right w-1/4">Total Amount</th>
                      <th>Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockMetrics.valueByStatus.map((row, idx) => {
                      const maxAmount = Math.max(...mockMetrics.valueByStatus.map(r => r.totalAmount));
                      const pct = (row.totalAmount / maxAmount) * 100;
                      
                      let stampColor = "text-inherit";
                      let stampBorder = "border-[var(--ledger-ink)] text-[var(--ledger-ink)]";
                      
                      if (row.status === "EXCEPTION") stampBorder = "border-[var(--ledger-red)] text-[var(--ledger-red)]";
                      if (row.status === "APPROVED") stampBorder = "border-[var(--ledger-green)] text-[var(--ledger-green)]";
                      if (row.status === "PENDING_APPROVAL") stampBorder = "border-[var(--ledger-gold)] text-[var(--ledger-gold)]";
                      if (row.status === "POSTED") stampBorder = "border-[var(--ledger-blue)] text-[var(--ledger-blue)]";

                      return (
                        <tr key={row.status} className={idx % 2 === 0 ? "bg-[var(--ledger-bg)]" : ""}>
                          <td>
                            <div className={`stamp ${stampBorder}`}>
                              {row.status.replace(/_/g, " ")}
                            </div>
                          </td>
                          <td className="text-right">{row.count}</td>
                          <td className="text-right">{formatCurrency(row.totalAmount)}</td>
                          <td>
                            <div className="w-full flex items-center gap-2">
                              <div className="flex-1 h-3 border border-[var(--ledger-border)] bg-[var(--ledger-bg)] p-[1px]">
                                <div 
                                  className="h-full bg-[var(--ledger-ink)]" 
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="font-sans text-[10px] w-8 text-right text-[var(--ledger-ink-light)]">
                                {Math.round((row.totalAmount / mockMetrics.totalApprovedAmount) * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            
          </div>
        </main>
      </div>
    </div>
  );
}
