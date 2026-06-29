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
import { VendorCleanupPage } from "@/pages/vendor-cleanup";
import { DashboardPage } from "@/pages/dashboard";
import { VendorAnalytics } from "@/pages/vendor-analytics";
import { ExceptionManagement } from "@/pages/exception-management";
import { AdvancedSearch } from "@/pages/advanced-search";
import { ImportsPage } from "@/pages/imports";
import { ExportsPage } from "@/pages/exports";
import { SourceDocuments } from "@/pages/source-documents";
import { AccuracyReporting } from "@/pages/accuracy";
import { AuditViewer } from "@/pages/audit-viewer";
import { SettingsPage } from "@/pages/settings";
import { Phase3Placeholder } from "@/pages/phase3";
import NotFound from "@/pages/not-found";

export function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />

        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/search" component={AdvancedSearch} />

        <Route path="/invoices" component={InvoiceList} />
        <Route path="/invoices/new" component={InvoiceIntake} />
        <Route path="/sources/:id" component={SourceBatch} />
        <Route path="/invoices/:id" component={ExtractionReview} />

        <Route path="/sources" component={SourceDocuments} />
        <Route path="/exceptions" component={ExceptionQueue} />
        <Route path="/exception-management" component={ExceptionManagement} />
        <Route path="/approvals" component={ApprovalQueue} />
        <Route path="/vendors" component={VendorAdmin} />
        <Route path="/vendors/cleanup" component={VendorCleanupPage} />
        <Route path="/vendors/:id" component={VendorDetail} />
        <Route path="/analytics" component={VendorAnalytics} />

        <Route path="/imports" component={ImportsPage} />
        <Route path="/exports" component={ExportsPage} />

        <Route path="/accuracy" component={AccuracyReporting} />
        <Route path="/audit" component={AuditViewer} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/phase3" component={Phase3Placeholder} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}
