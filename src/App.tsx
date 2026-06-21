import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './layouts/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SendersReceivers from './pages/SendersReceivers';
import Cities from './pages/Cities';
import GoodsTypes from './pages/GoodsTypes';
import Drivers from './pages/Drivers';
import Vehicles from './pages/Vehicles';
import Tariffs from './pages/Tariffs';
import ShipmentEntry from './pages/ShipmentEntry';
import ShipmentQuickLedger from './pages/ShipmentQuickLedger';
import ShipmentList from './pages/ShipmentList';
import Manifest from './pages/Manifest';
import Delivery from './pages/Delivery';
import Centers from './pages/Centers';
import Reports from './pages/Reports';
import PrintPreview from './pages/PrintPreview';
import Settings from './pages/Settings';
import TelegramSettings from './pages/settings/TelegramSettings';
import FinanceExpenses from './pages/finance/Expenses';
import FinanceSalaries from './pages/finance/Salaries';
import FinanceCashBoxes from './pages/finance/CashBoxes';
import CashBoxMovements from './pages/finance/CashBoxMovements';
import FinanceVouchers from './pages/finance/Vouchers';
import FinanceRecords from './pages/finance/Records';
import DailyJournal from './pages/finance/DailyJournal';
import FinanceStatementsShell from './pages/finance/statements/FinanceStatementsShell';
import PartyStatementPage from './pages/finance/statements/PartyStatementPage';
import CashboxStatementPage from './pages/finance/statements/CashboxStatementPage';
import VoucherStatementPage from './pages/finance/statements/VoucherStatementPage';
import DailyLedgerSummaryPage from './pages/finance/statements/DailyLedgerSummaryPage';
import ShipmentsDatePage from './pages/finance/statements/ShipmentsDatePage';
import EmbeddedHawalaStatement from './pages/finance/statements/EmbeddedHawalaStatement';
import EmbeddedAgentBranchReconciliation from './pages/finance/statements/EmbeddedAgentBranchReconciliation';
import EmbeddedLedgerAudit from './pages/finance/statements/EmbeddedLedgerAudit';
import EmbeddedCodStatement from './pages/finance/statements/EmbeddedCodStatement';
import BilateralReconciliation from './pages/finance/BilateralReconciliation';
import FinanceReports from './pages/finance/Reports';
import FinanceReportsShell from './pages/finance/reports/FinanceReportsShell';
import ProfitLossReport from './pages/finance/reports/ProfitLossReport';
import GeneralLedger from './pages/finance/GeneralLedger';
import TrialBalance from './pages/finance/TrialBalance';
import BalanceSheet from './pages/finance/BalanceSheet';
import PeriodClosing from './pages/finance/PeriodClosing';
import AgentsModule from './pages/agents/AgentsModule';
import AgentProfile from './pages/agents/AgentProfile';
import BranchesModule from './pages/branches/BranchesModule';
import BranchProfile from './pages/branches/BranchProfile';
import CustomersModule from './pages/customers/CustomersModule';
import CustomerProfile from './pages/customers/CustomerProfile';
import AccessDenied from './pages/AccessDenied';
import Transfers from './pages/Transfers';
import TransfersShell from './pages/transfers/TransfersShell';
import TransferReports from './pages/transfers/TransferReports';
import PermissionsCenter from './pages/PermissionsCenter';
import AdminEvents from './pages/admin/AdminEvents';
import DailyLedgerDocumentation from './pages/shipping/DailyLedgerDocumentation';
import AgentPortal from './pages/AgentPortal';
import AgentDeliveryQueues from './pages/agent/AgentDeliveryQueues';
import { ToastProvider } from './components/Toast';
import { useAuth } from './context/AuthProvider';
import RequireAuth from './components/RequireAuth';
import RequirePermission from './components/RequirePermission';
import RequireAnyPermission from './components/RequireAnyPermission';
import { NAV_PERMISSION_ALIASES } from './lib/auth/navPermissionAliases';

function FinanceLegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="text-gray-500">جاري تحميل الجلسة...</span>
      </div>
    );
  }

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to={user.userType === 'agent' ? '/agent-portal' : '/dashboard'} replace /> : <Login />}
        />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Layout
                user={{
                  name: user?.username || '-',
                  branchId: user?.branchId || null,
                }}
                onLogout={() => {
                  void logout('manual');
                }}
              >
                <Routes>
                  <Route path="/" element={<Navigate to={user?.userType === 'agent' ? '/agent-portal' : '/dashboard'} replace />} />
                  <Route path="/dashboard" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Dashboard />} />
                  <Route path="/access-denied" element={<AccessDenied />} />
                  <Route
                    path="/customers"
                    element={
                      <RequirePermission permission="customers.view">
                        <CustomersModule />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/customers/:id"
                    element={
                      <RequirePermission permission="customers.view">
                        <CustomerProfile />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/senders-receivers"
                    element={
                      <RequirePermission permission="parties.view">
                        <SendersReceivers />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/cities"
                    element={
                      <RequirePermission permission="shipments.read">
                        <Cities />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/goods-types"
                    element={
                      <RequirePermission permission="shipments.read">
                        <GoodsTypes />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/drivers"
                    element={
                      <RequirePermission permission="drivers.view">
                        <Drivers />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/vehicles"
                    element={
                      <RequirePermission permission="vehicles.view">
                        <Vehicles />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/shipment-entry"
                    element={
                      <RequirePermission permission="shipments.write">
                        <Navigate to="/shipment-quick-ledger" replace />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/shipment-entry/:id"
                    element={
                      <RequirePermission permission="shipments.write">
                        <ShipmentEntry />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/shipment-quick-ledger"
                    element={
                      <RequirePermission permission="shipments.write">
                        <ShipmentQuickLedger />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/daily-ledger/documentation"
                    element={
                      <RequireAnyPermission permissions={['daily_ledger.documentation.read', 'shipments.read', 'shipments.write']}>
                        <DailyLedgerDocumentation />
                      </RequireAnyPermission>
                    }
                  />
                  <Route
                    path="/shipments"
                    element={
                      <RequirePermission permission="shipments.read">
                        <ShipmentList />
                      </RequirePermission>
                    }
                  />
                  <Route path="/manifest" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Manifest />} />
                  <Route
                    path="/centers"
                    element={
                      <RequirePermission permission="deliveries.read">
                        <Centers />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/delivery"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/delivery-queue/pending" replace />
                      ) : (
                        <RequirePermission permission="deliveries.read">
                          <Delivery />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/delivery-queue/:tab"
                    element={
                      <RequirePermission permission="deliveries.read">
                        <AgentDeliveryQueues />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/transfers"
                    element={
                      <RequirePermission permission="transfers.read">
                        <TransfersShell />
                      </RequirePermission>
                    }
                  >
                    <Route index element={<Transfers />} />
                    <Route path="reports" element={<TransferReports />} />
                  </Route>
                  <Route
                    path="/permissions"
                    element={
                      <RequirePermission permission="permissions.view">
                        <PermissionsCenter />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/events"
                    element={
                      <RequirePermission permission="admin.events.read">
                        <AdminEvents />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/agent-portal"
                    element={
                      <RequirePermission permission="agent_portal.view">
                        <AgentPortal />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/agents"
                    element={
                      <RequirePermission permission="settings.agents.read">
                        <AgentsModule />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/agents/:id"
                    element={
                      <RequirePermission permission="settings.agents.read">
                        <AgentProfile />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/branches"
                    element={
                      <RequirePermission permission="settings.branches.read">
                        <BranchesModule />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/branches/:id"
                    element={
                      <RequirePermission permission="settings.branches.read">
                        <BranchProfile />
                      </RequirePermission>
                    }
                  />

                  <Route
                    path="/finance/expenses"
                    element={
                      <RequirePermission permission="finance.read">
                        <FinanceExpenses />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/finance/salaries"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <FinanceSalaries />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/cashboxes"
                    element={
                      <RequirePermission permission="finance.cashboxes.view">
                        <FinanceCashBoxes />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/finance/cashboxes/:id/movements"
                    element={
                      <RequirePermission permission="finance.cashboxes.movements.view">
                        <CashBoxMovements />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/finance/vouchers"
                    element={
                      <RequirePermission permission="finance.vouchers.view">
                        <FinanceVouchers />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/finance/records"
                    element={
                      <RequirePermission permission="finance.read">
                        <FinanceRecords />
                      </RequirePermission>
                    }
                  />
                  <Route path="/finance/tariffs" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Tariffs />} />
                  <Route
                    path="/finance/daily-journal"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <DailyJournal />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/bilateral-reconciliation"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <BilateralReconciliation />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/statements"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequireAnyPermission permissions={NAV_PERMISSION_ALIASES['finance.read']}>
                          <FinanceStatementsShell />
                        </RequireAnyPermission>
                      )
                    }
                  >
                    <Route path="parties/agent" element={<PartyStatementPage partyType="agent" />} />
                    <Route path="parties/customer" element={<PartyStatementPage partyType="customer" />} />
                    <Route path="parties/sender-receiver" element={<PartyStatementPage partyType="sender_receiver" />} />
                    <Route path="cash/cashbox" element={<CashboxStatementPage />} />
                    <Route path="cash/receipts" element={<VoucherStatementPage voucherType="receipt" />} />
                    <Route path="cash/payments" element={<VoucherStatementPage voucherType="payment" />} />
                    <Route path="shipping/ledger-summary" element={<DailyLedgerSummaryPage />} />
                    <Route path="shipping/shipments" element={<ShipmentsDatePage />} />
                    <Route path="shipping/cod" element={<EmbeddedCodStatement />} />
                    <Route path="hawala" element={<EmbeddedHawalaStatement />} />
                    <Route path="reconciliation/agent-branch" element={<EmbeddedAgentBranchReconciliation />} />
                    <Route path="reconciliation/ledger" element={<EmbeddedLedgerAudit />} />
                  </Route>
                  <Route
                    path="/finance/general-ledger"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <GeneralLedger />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route path="/finance/debit-credit" element={<FinanceLegacyRedirect to="/finance/general-ledger" />} />
                  <Route path="/finance/account-statement" element={<FinanceLegacyRedirect to="/finance/daily-journal" />} />
                  <Route path="/finance/agent-settlement" element={<Navigate to="/finance/statements/reconciliation/agent-branch" replace />} />
                  <Route path="/finance/agent-cod-statement" element={<Navigate to="/finance/statements/shipping/cod" replace />} />
                  <Route path="/finance/hawala-reconciliation" element={<Navigate to="/finance/statements/hawala" replace />} />
                  <Route path="/finance/ledger-finance-audit" element={<Navigate to="/finance/statements/reconciliation/ledger" replace />} />
                  <Route path="/finance/agent-branch-reconciliation" element={<Navigate to="/finance/statements/reconciliation/agent-branch" replace />} />
                  <Route
                    path="/finance/trial-balance"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <TrialBalance />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/balance-sheet"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <BalanceSheet />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/period-closing"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <PeriodClosing />
                        </RequirePermission>
                      )
                    }
                  />

                  <Route
                    path="/finance/reports"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <FinanceReportsShell />
                        </RequirePermission>
                      )
                    }
                  >
                    <Route index element={<FinanceReports />} />
                    <Route path="profit-loss" element={<ProfitLossReport />} />
                  </Route>
                  <Route path="/finance/delivery-reports" element={<FinanceLegacyRedirect to="/finance/reports" />} />

                  <Route path="/reports" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Reports />} />
                  <Route path="/print-preview" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <PrintPreview />} />
                  <Route path="/settings" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Settings />} />
                  <Route path="/settings/users_roles" element={<Navigate to={user?.userType === 'agent' ? '/agent-portal' : '/permissions'} replace />} />
                  <Route path="/settings/branches" element={<Navigate to={user?.userType === 'agent' ? '/agent-portal' : '/branches'} replace />} />
                  <Route path="/settings/agents" element={<Navigate to={user?.userType === 'agent' ? '/agent-portal' : '/agents'} replace />} />
                  <Route path="/settings/:sectionId" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <Settings />} />
                  <Route
                    path="/settings/telegram"
                    element={
                      <RequirePermission permission="settings.telegram.read">
                        <TelegramSettings />
                      </RequirePermission>
                    }
                  />
                </Routes>
              </Layout>
            </RequireAuth>
          }
        />
      </Routes>
    </ToastProvider>
  );
}
