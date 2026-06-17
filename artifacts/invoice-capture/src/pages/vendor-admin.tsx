import { useState } from "react";
import { 
  useListVendors, 
  useCreateVendor, 
  useImportVendors 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Upload, Users, Search } from "lucide-react";
import { format } from "date-fns";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function VendorAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  
  const { data: vendorsRes, isLoading } = useListVendors({ search, limit: 100 });
  const createVendor = useCreateVendor();
  const importVendors = useImportVendors();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newVendor, setNewVendor] = useState({ vendorCode: "", vendorName: "", taxId: "", contactEmail: "" });

  const handleAddVendor = async () => {
    if (!newVendor.vendorCode || !newVendor.vendorName) return;
    try {
      await createVendor.mutateAsync({ data: newVendor });
      toast({ title: "Vendor Created", description: `${newVendor.vendorName} added successfully.` });
      setIsAddOpen(false);
      setNewVendor({ vendorCode: "", vendorName: "", taxId: "", contactEmail: "" });
      queryClient.invalidateQueries();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create vendor" });
    }
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n');
        // Simple CSV parse: skip header
        const vendors = lines.slice(1)
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [vendorCode, vendorName, taxId, contactEmail] = line.split(',');
            return {
              vendorCode: vendorCode?.trim() || "",
              vendorName: vendorName?.trim() || "",
              taxId: taxId?.trim() || null,
              contactEmail: contactEmail?.trim() || null,
            };
          }).filter(v => v.vendorCode && v.vendorName);

        if (vendors.length === 0) throw new Error("No valid rows found");

        const res = await importVendors.mutateAsync({ data: { vendors } });
        toast({ title: "Import Successful", description: `Imported ${res.inserted} vendors. Skipped ${res.skipped}.` });
        queryClient.invalidateQueries();
      } catch (e: any) {
        toast({ variant: "destructive", title: "Import Error", description: e.message || "Invalid CSV format" });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6 flex flex-col h-full overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            Vendor Administration
          </h1>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <input 
              type="file" 
              accept=".csv" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              onChange={handleCsvImport}
              data-testid="input-csv-import"
            />
            <Button variant="outline" data-testid="button-import">
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
          </div>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-vendor">
                <Plus className="mr-2 h-4 w-4" />
                Add Vendor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Vendor</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Vendor Code *</Label>
                  <Input 
                    value={newVendor.vendorCode} 
                    onChange={e => setNewVendor(prev => ({...prev, vendorCode: e.target.value}))}
                    data-testid="input-vendor-code"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vendor Name *</Label>
                  <Input 
                    value={newVendor.vendorName} 
                    onChange={e => setNewVendor(prev => ({...prev, vendorName: e.target.value}))}
                    data-testid="input-vendor-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tax ID</Label>
                  <Input 
                    value={newVendor.taxId} 
                    onChange={e => setNewVendor(prev => ({...prev, taxId: e.target.value}))}
                    data-testid="input-vendor-tax"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contact Email</Label>
                  <Input 
                    type="email"
                    value={newVendor.contactEmail} 
                    onChange={e => setNewVendor(prev => ({...prev, contactEmail: e.target.value}))}
                    data-testid="input-vendor-email"
                  />
                </div>
                <Button 
                  className="w-full mt-4" 
                  onClick={handleAddVendor}
                  disabled={!newVendor.vendorCode || !newVendor.vendorName || createVendor.isPending}
                  data-testid="button-save-vendor"
                >
                  {createVendor.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Vendor"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="py-3 px-4 shrink-0 bg-muted/30 border-b">
          <div className="relative w-72">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search vendors..." 
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Tax ID</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : vendorsRes?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No vendors found.
                  </TableCell>
                </TableRow>
              ) : (
                vendorsRes?.data?.map((vendor) => (
                  <TableRow key={vendor.id} data-testid={`row-vendor-${vendor.id}`}>
                    <TableCell className="font-medium">{vendor.vendorCode}</TableCell>
                    <TableCell>{vendor.vendorName}</TableCell>
                    <TableCell>{vendor.taxId || "—"}</TableCell>
                    <TableCell>{vendor.contactEmail || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <div className={`h-2 w-2 rounded-full mr-2 ${vendor.isActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                        {vendor.isActive ? 'Active' : 'Inactive'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(vendor.createdAt), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
