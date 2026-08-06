import React, { useState } from 'react';
import { 
  Check, 
  ChevronRight, 
  AlertTriangle, 
  CornerDownLeft, 
  Search, 
  Eye,
  Maximize2,
  MoreHorizontal
} from 'lucide-react';

export default function ExtractionFocusMode() {
  const [activeIssue, setActiveIssue] = useState<number>(0);

  const issues = [
    {
      id: 1,
      type: 'vendor_mismatch',
      label: 'Vendor Identification',
      extracted: 'ACME DISTRIB',
      confidence: 42,
      suggestion: 'Acme Distribution Inc.',
      description: 'The extracted vendor name does not perfectly match our records. Did you mean Acme Distribution Inc.?'
    },
    {
      id: 2,
      type: 'date_format',
      label: 'Invoice Date',
      extracted: '12/04/23',
      confidence: 65,
      suggestion: 'Dec 4, 2023',
      description: 'Ambiguous date format (DD/MM or MM/DD). Based on vendor history, we assume MM/DD/YY.'
    }
  ];

  const autoVerified = [
    { label: 'Total Amount', value: '$4,250.00' },
    { label: 'Tax Amount', value: '$250.00' },
    { label: 'Invoice Number', value: 'INV-2023-8991' },
    { label: 'PO Number', value: 'PO-99120' }
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-[#ededed] font-sans flex flex-col md:flex-row overflow-hidden selection:bg-indigo-500/30">
      
      {/* Left side: Document Viewer */}
      <div className="flex-1 border-r border-[#222] flex flex-col relative h-[50vh] md:h-screen">
        {/* Top bar for document */}
        <div className="h-14 border-b border-[#222] flex items-center justify-between px-4 bg-[#0a0a0a]/80 backdrop-blur-md absolute top-0 w-full z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#111] border border-[#333] flex items-center justify-center">
              <Eye className="w-4 h-4 text-[#888]" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-[#888] font-mono">DOC-9942</span>
              <span className="text-sm font-medium">Acme_Invoice_Nov.pdf</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-[#222] rounded-md transition-colors text-[#888] hover:text-[#ededed]">
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Document Area */}
        <div className="flex-1 bg-[#111] p-8 md:p-20 pt-24 overflow-auto flex items-center justify-center">
          {/* Dummy Document Placeholder */}
          <div className="w-full max-w-2xl bg-white aspect-[1/1.4] rounded-sm shadow-2xl relative overflow-hidden">
            {/* Fake text lines to look like a document */}
            <div className="absolute top-12 left-12 right-12 bottom-12 border-2 border-transparent">
              <div className="w-32 h-12 bg-gray-200 mb-12"></div>
              
              <div className="flex justify-between mb-16">
                <div>
                  <div className="w-40 h-4 bg-gray-200 mb-2"></div>
                  <div className="w-32 h-4 bg-gray-200 mb-2"></div>
                  <div className="w-48 h-4 bg-gray-200"></div>
                </div>
                <div className="text-right">
                  <div className="w-24 h-4 bg-gray-200 mb-2 ml-auto"></div>
                  <div className="w-32 h-4 bg-gray-200 mb-2 ml-auto"></div>
                </div>
              </div>

              <div className="w-full border-t border-gray-200 mb-4"></div>
              
              <div className="space-y-4 mb-16">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex justify-between">
                    <div className="w-64 h-4 bg-gray-100"></div>
                    <div className="w-16 h-4 bg-gray-100"></div>
                  </div>
                ))}
              </div>

              <div className="w-full border-t border-gray-200 mb-4"></div>
              
              <div className="flex justify-end">
                <div className="w-48">
                  <div className="flex justify-between mb-2">
                    <div className="w-20 h-4 bg-gray-200"></div>
                    <div className="w-16 h-4 bg-gray-200"></div>
                  </div>
                  <div className="flex justify-between">
                    <div className="w-24 h-6 bg-gray-300"></div>
                    <div className="w-20 h-6 bg-gray-300"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Highlights mimicking spatial extraction */}
            <div className="absolute top-[108px] left-[48px] w-[160px] h-[20px] bg-amber-500/20 border border-amber-500/50 rounded-sm animate-pulse">
              <div className="absolute -top-6 left-0 text-[10px] font-mono text-amber-600 font-bold bg-amber-100 px-1 rounded shadow-sm">Vendor Mismatch</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side: Triage Center */}
      <div className="w-full md:w-[420px] lg:w-[480px] bg-[#050505] flex flex-col h-[50vh] md:h-screen">
        
        {/* Header */}
        <div className="h-14 border-b border-[#222] px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <span className="font-mono text-sm tracking-wide text-[#a1a1aa]">REVIEW QUEUE</span>
          </div>
          <div className="text-xs text-[#666] font-mono">
            1 of 12
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          
          {/* Status Header */}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2 text-white">Attention Required</h1>
            <p className="text-[#888] text-sm">We extracted the data, but found {issues.length} issues that need your human judgment before approval.</p>
          </div>

          {/* Issue Cards */}
          <div className="flex flex-col gap-4">
            {issues.map((issue, idx) => {
              const isActive = activeIssue === idx;
              return (
                <div 
                  key={issue.id}
                  onClick={() => setActiveIssue(idx)}
                  className={`relative p-5 rounded-xl border transition-all cursor-pointer ${
                    isActive 
                      ? 'bg-[#111] border-[#444] shadow-[0_0_20px_rgba(255,255,255,0.03)]' 
                      : 'bg-[#0a0a0a] border-[#222] hover:border-[#333] opacity-60 hover:opacity-100'
                  }`}
                >
                  {/* Left accent line */}
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-12 bg-indigo-500 rounded-r-full"></div>}
                  
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2 text-amber-500">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-mono font-medium tracking-wide uppercase">{issue.label}</span>
                    </div>
                    <span className="text-xs text-[#666] font-mono">{issue.confidence}% CONFIDENCE</span>
                  </div>

                  <p className="text-sm text-[#a1a1aa] mb-4 leading-relaxed">
                    {issue.description}
                  </p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-[#000] p-3 rounded-lg border border-[#222]">
                      <div className="text-[10px] text-[#666] font-mono uppercase mb-1">Extracted</div>
                      <div className="text-sm text-white line-through opacity-70">{issue.extracted}</div>
                    </div>
                    <div className="bg-indigo-500/10 p-3 rounded-lg border border-indigo-500/30">
                      <div className="text-[10px] text-indigo-400 font-mono uppercase mb-1">Suggestion</div>
                      <div className="text-sm text-white">{issue.suggestion}</div>
                    </div>
                  </div>

                  {isActive && (
                    <div className="flex gap-2 pt-2 border-t border-[#222]">
                      <button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2">
                        Accept Suggestion
                        <div className="flex items-center text-[10px] bg-indigo-900/50 px-1.5 py-0.5 rounded text-indigo-200 font-mono">
                          <CornerDownLeft className="w-3 h-3 mr-1" /> ENTER
                        </div>
                      </button>
                      <button className="px-4 bg-[#222] hover:bg-[#333] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center">
                        Edit...
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Auto-verified Data */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="font-mono text-sm tracking-wide text-[#a1a1aa] uppercase">Auto-Verified Data</span>
            </div>
            
            <div className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden">
              {autoVerified.map((item, i) => (
                <div key={i} className="flex justify-between items-center p-4 border-b border-[#222] last:border-0">
                  <span className="text-sm text-[#888]">{item.label}</span>
                  <span className="text-sm font-mono text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#222] bg-[#0a0a0a] flex items-center justify-between shrink-0">
          <button className="p-2 text-[#666] hover:text-white transition-colors">
            <MoreHorizontal className="w-5 h-5" />
          </button>
          
          <button className="bg-white text-black hover:bg-gray-200 px-6 py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Approve Invoice
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
