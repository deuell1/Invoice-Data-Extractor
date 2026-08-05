import { Switch, Route, Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { InvoiceList } from "@/pages/invoice-list";
import { InvoiceIntake } from "@/pages/invoice-intake";
import { ExtractionReview } from "@/pages/extraction-review";
import { SourceBatch } from "@/pages/source-batch";
import { ExceptionQueue } from "@/pages/exception-queue";
import { ApprovalQueue } from "@/pages/approval-queue";
import { VendorAdmin } from "@/pages/vendor-admin";
import { VendorDetail } from "@/pages/vendor-detail";
import { DashboardPage } from "@/pages/dashboard";
import { ImportsPage } from "@/pages/imports";
import { ExportsPage } from "@/pages/exports";
import { SourceDocuments } from "@/pages/source-documents";
import { AuditViewer } from "@/pages/audit-viewer";
import { SettingsPage } from "@/pages/settings";
import NotFound from "@/pages/not-found";

export function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />

        <Route path="/dashboard" component={DashboardPage} />

        <Route path="/invoices" component={InvoiceList} />
        <Route path="/invoices/new" component={InvoiceIntake} />
        <Route path="/sources/:id" component={SourceBatch} />
        <Route path="/invoices/:id" component={ExtractionReview} />

        <Route path="/sources" component={SourceDocuments} />
        <Route path="/exceptions" component={ExceptionQueue} />
        <Route path="/approvals" component={ApprovalQueue} />
        <Route path="/vendors" component={VendorAdmin} />
        <Route path="/vendors/:id" component={VendorDetail} />

        <Route path="/imports" component={ImportsPage} />
        <Route path="/exports" component={ExportsPage} />

        <Route path="/audit" component={AuditViewer} />
        <Route path="/settings" component={SettingsPage} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}
