import {
  useListUsers,
  usePatchUserRole,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/mission-control-ds/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/mission-control-ds/components/ui/select";
import { Badge } from "@workspace/mission-control-ds/components/ui/badge";
import { useToast } from "@workspace/mission-control-ds/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Users, Settings as SettingsIcon } from "lucide-react";
import { useIsManager } from "@/hooks/use-role";
import { Link, useLocation } from "wouter";

export function SettingsUsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const [location] = useLocation();

  const { data: users, isLoading, error } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });

  const patchRole = usePatchUserRole();

  const handleRoleChange = async (userId: string, role: "AP_MANAGER" | "AP_CLERK") => {
    try {
      await patchRole.mutateAsync({ userId, data: { role } });
      toast({ title: "Role updated", description: `User role changed to ${role}.` });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e?.data?.error || e?.message || "Failed to update user role.",
      });
    }
  };

  const subNav = (
    <div className="flex gap-1 border-b pb-0 shrink-0">
      <Link href="/settings">
        <button
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            location === "/settings"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-settings-config"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
          Configuration
        </button>
      </Link>
      <Link href="/settings/users">
        <button
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            location === "/settings/users"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-settings-users"
        >
          <Users className="h-3.5 w-3.5" />
          Users
        </button>
      </Link>
    </div>
  );

  if (!isManager) {
    return (
      <div className="space-y-6 flex flex-col h-full">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            Settings
          </h1>
        </div>
        {subNav}
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground text-sm">
            Only AP Managers can manage user roles.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assign AP Clerk or AP Manager roles to team members
        </p>
      </div>
      {subNav}

      <div className="max-w-2xl w-full">
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              Role changes take effect on the user's next login.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="py-10 text-center text-sm text-destructive">
                Failed to load users.
              </div>
            ) : !users || users.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No users found.
              </div>
            ) : (
              <div className="divide-y">
                {users.map((user) => {
                  const displayName =
                    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
                  const initials = (user.firstName?.[0] ?? user.email[0] ?? "?").toUpperCase();

                  return (
                    <div
                      key={user.userId}
                      className="flex items-center justify-between py-3 gap-4"
                      data-testid={`user-row-${user.userId}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{displayName}</p>
                          {displayName !== user.email && (
                            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={user.role === "AP_MANAGER" ? "default" : "secondary"}
                          className="text-xs hidden sm:inline-flex"
                        >
                          {user.role === "AP_MANAGER" ? "Manager" : "Clerk"}
                        </Badge>
                        <Select
                          value={user.role}
                          onValueChange={(v) =>
                            handleRoleChange(user.userId, v as "AP_MANAGER" | "AP_CLERK")
                          }
                          disabled={patchRole.isPending}
                        >
                          <SelectTrigger
                            className="w-36 h-8 text-xs"
                            data-testid={`role-select-${user.userId}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AP_MANAGER">AP Manager</SelectItem>
                            <SelectItem value="AP_CLERK">AP Clerk</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
