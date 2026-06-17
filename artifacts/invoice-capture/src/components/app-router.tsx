import { Switch, Route, Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { InvoiceList } from "@/pages/invoice-list";
import { InvoiceIntake } from "@/pages/invoice-intake";
import { ExtractionReview } from "@/pages/extraction-review";
import { ExceptionQueue } from "@/pages/exception-queue";
import { ApprovalQueue } from "@/pages/approval-queue";
import { VendorAdmin } from "@/pages/vendor-admin";
import NotFound from "@/pages/not-found";

export function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/invoices" />} />
        
        <Route path="/invoices" component={InvoiceList} />
        <Route path="/invoices/new" component={InvoiceIntake} />
        <Route path="/invoices/:id" component={ExtractionReview} />
        
        <Route path="/exceptions" component={ExceptionQueue} />
        <Route path="/approvals" component={ApprovalQueue} />
        <Route path="/vendors" component={VendorAdmin} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}
