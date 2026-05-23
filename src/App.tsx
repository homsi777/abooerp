import { Routes, Route, Navigate } from 'react-router-dom';
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
import FinanceReports from './pages/finance/Reports';
import FinanceDeliveryReports from './pages/finance/DeliveryReports';
import DebitCreditCenter from './pages/finance/DebitCreditCenter';
import AccountStatement from './pages/finance/AccountStatement';
import AgentCodStatement from './pages/finance/AgentCodStatement';
import AgentsModule from './pages/agents/AgentsModule';
import AgentProfile from './pages/agents/AgentProfile';
import BranchesModule from './pages/branches/BranchesModule';
import BranchProfile from './pages/branches/BranchProfile';
import CustomersModule from './pages/customers/CustomersModule';
import CustomerProfile from './pages/customers/CustomerProfile';
import AccessDenied from './pages/AccessDenied';
import Transfers from './pages/Transfers';
import PermissionsCenter from './pages/PermissionsCenter';
import AdminEvents from './pages/admin/AdminEvents';
import AgentPortal from './pages/AgentPortal';
import AgentDeliveryQueues from './pages/agent/AgentDeliveryQueues';
import { ToastProvider } from './components/Toast';
import { useAuth } from './context/AuthProvider';
import RequireAuth from './components/RequireAuth';
import RequirePermission from './components/RequirePermission';

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
                        <Transfers />
                      </RequirePermission>
                    }
                  />
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
                  <Route path="/finance/daily-journal" element={user?.userType === 'agent' ? <Navigate to="/agent-portal" replace /> : <DailyJournal />} />
                  <Route
                    path="/finance/debit-credit"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <DebitCreditCenter />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/account-statement"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <AccountStatement />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/agent-cod-statement"
                    element={
                      <RequirePermission permission="finance.read">
                        <AgentCodStatement />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/finance/reports"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <FinanceReports />
                        </RequirePermission>
                      )
                    }
                  />
                  <Route
                    path="/finance/delivery-reports"
                    element={
                      user?.userType === 'agent' ? (
                        <Navigate to="/agent-portal" replace />
                      ) : (
                        <RequirePermission permission="finance.read">
                          <FinanceDeliveryReports />
                        </RequirePermission>
                      )
                    }
                  />

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
