import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  FileText, 
  AlertCircle, 
  CheckSquare, 
  Users, 
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  Search,
  Files,
  ShieldAlert,
  BarChart3,
  Upload,
  Download,
  Target,
  History,
  Settings,
  Construction,
  RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Invoices", href: "/invoices", icon: FileText },
    { name: "Search", href: "/search", icon: Search },
    { name: "Sources", href: "/sources", icon: Files },
    { name: "Exceptions", href: "/exceptions", icon: AlertCircle },
    { name: "Exception Mgmt", href: "/exception-management", icon: ShieldAlert },
    { name: "Approvals", href: "/approvals", icon: CheckSquare },
    { name: "Vendors", href: "/vendors", icon: Users },
    { name: "Vendor Cleanup", href: "/vendors/cleanup", icon: RotateCcw },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Imports", href: "/imports", icon: Upload },
    { name: "Exports", href: "/exports", icon: Download },
    { name: "Accuracy", href: "/accuracy", icon: Target },
    { name: "Audit", href: "/audit", icon: History },
    { name: "Settings", href: "/settings", icon: Settings },
    { name: "Phase 3", href: "/phase3", icon: Construction },
  ];

  return (
    <div className="flex h-screen bg-gray-50/50 dark:bg-gray-900/50 overflow-hidden">
      {/* Sidebar */}
      <div 
        className={cn(
          "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 z-10",
          sidebarOpen ? "w-64" : "w-16"
        )}
      >
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <div className={cn("font-semibold text-sidebar-foreground truncate flex-1", !sidebarOpen && "hidden")}>
            Invoice Capture
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-toggle-sidebar"
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            {navigation.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + "/");
              return (
                <Link 
                  key={item.name} 
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive 
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" 
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  data-testid={`nav-${item.name.toLowerCase()}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className={cn("truncate", !sidebarOpen && "hidden")}>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        <div className="p-4 border-t border-sidebar-border shrink-0">
          <div className={cn("text-xs text-sidebar-foreground/60 truncate", !sidebarOpen && "hidden")}>
            AP System MVP
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 bg-background border-b flex items-center px-4 shrink-0 shadow-sm z-0">
          {!sidebarOpen && (
            <div className="font-semibold text-foreground mr-4">
              Invoice Capture
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto p-6 bg-muted/20">
          <div className="mx-auto max-w-7xl h-full flex flex-col">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
