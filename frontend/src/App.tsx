import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Projects } from './pages/Projects';
import { Procurement } from './pages/Procurement';
import { Approvals } from './pages/Approvals';
import { CostControl } from './pages/CostControl';
import { Finance } from './pages/Finance';
import { TechnicalOffice } from './pages/TechnicalOffice';
import { Planning } from './pages/Planning';
import { SiteExecution } from './pages/SiteExecution';
import { HR } from './pages/HR';
import { Assets } from './pages/Assets';
import { QAQC } from './pages/QAQC';
import { HSE } from './pages/HSE';
import { EDMS } from './pages/EDMS';
import { ExecutiveDashboard } from './pages/ExecutiveDashboard';
import { Reports } from './pages/Reports';
import { Portals } from './pages/Portals';
import { RuntimeValidation } from './pages/RuntimeValidation';
import { CRM } from './pages/CRM';
import { Tendering } from './pages/Tendering';
import { Contracts } from './pages/Contracts';
import { Inventory } from './pages/Inventory';
import { Claims } from './pages/Claims';
import { Subcontracts } from './pages/Subcontracts';
import { BOQ } from './pages/BOQ';
import { Admin } from './pages/Admin';
import { AIPlatform } from './pages/AIPlatform';
import { CommercialPlatform } from './pages/CommercialPlatform';
import { Automation } from './pages/Automation';
import { Knowledge } from './pages/Knowledge';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="setup" element={<Setup />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="users" element={<Admin />} />
            <Route path="boq" element={<BOQ />} />
            <Route path="crm" element={<CRM />} />
            <Route path="tendering" element={<Tendering />} />
            <Route path="contracts" element={<Contracts />} />
            <Route path="claims" element={<Claims />} />
            <Route path="subcontracts" element={<Subcontracts />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="cost-control" element={<CostControl />} />
            <Route path="procurement" element={<Procurement />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="finance" element={<Finance />} />
            <Route path="technical-office" element={<TechnicalOffice />} />
            <Route path="planning" element={<Planning />} />
            <Route path="site" element={<SiteExecution />} />
            <Route path="hr" element={<HR />} />
            <Route path="assets" element={<Assets />} />
            <Route path="qaqc" element={<QAQC />} />
            <Route path="hse" element={<HSE />} />
            <Route path="edms" element={<EDMS />} />
            <Route path="executive-dashboard" element={<ExecutiveDashboard />} />
            <Route path="reports" element={<Reports />} />
            <Route path="portals" element={<Portals />} />
            <Route path="runtime-validation" element={<RuntimeValidation />} />
            <Route path="ai-platform" element={<AIPlatform />} />
            <Route path="commercial-platform" element={<CommercialPlatform />} />
            <Route path="automation" element={<Automation />} />
            <Route path="knowledge" element={<Knowledge />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
