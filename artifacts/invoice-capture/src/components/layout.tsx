import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { 
  FileText, 
  AlertCircle, 
  CheckSquare, 
  Users, 
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  Files,
  Upload,
  Download,
  History,
  Settings,
  FilePlus,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user } = useUser();
  const { signOut } = useClerk();

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

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.primaryEmailAddress?.emailAddress ||
      "User"
    : null;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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
              const isActive = location === item.href || 
                (item.href !== "/invoices/new" && location.startsWith(item.href + "/")) ||
                (item.href === "/invoices/new" && location === "/invoices/new");
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
                  data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className={cn("truncate", !sidebarOpen && "hidden")}>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/* User identity + sign out */}
        <div className="p-3 border-t border-sidebar-border shrink-0 space-y-2">
          {user && (
            <div className={cn("flex items-center gap-2 px-1", !sidebarOpen && "justify-center")}>
              {user.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={displayName ?? "User"}
                  className="h-7 w-7 rounded-full shrink-0 object-cover ring-1 ring-sidebar-border"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-sidebar-foreground" />
                </div>
              )}
              <span className={cn("text-xs text-sidebar-foreground/80 truncate flex-1", !sidebarOpen && "hidden")}>
                {displayName}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              !sidebarOpen && "px-0 justify-center"
            )}
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={cn("ml-2", !sidebarOpen && "hidden")}>Sign out</span>
          </Button>
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
