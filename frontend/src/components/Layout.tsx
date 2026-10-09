import { NavLink, Outlet } from 'react-router-dom';
import { logout } from '../lib/api';
import { BarChart3, ClipboardCheck, FolderKanban, Landmark, PackageCheck, ScrollText, DraftingCompass, CalendarDays, HardHat, UsersRound, Wrench, ShieldCheck, ShieldAlert, FolderArchive, FileBarChart, MonitorCheck, Globe2, Bot, Workflow, BookOpenCheck, BadgeDollarSign } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: BarChart3 },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/project-controls', label: 'Project Controls', icon: ShieldCheck },
  { to: '/users', label: 'Users / Roles / DOA', icon: UsersRound },
  { to: '/crm', label: 'CRM', icon: UsersRound },
  { to: '/tendering', label: 'Tendering', icon: ClipboardCheck },
  { to: '/boq', label: 'BOQ', icon: ScrollText },
  { to: '/contracts', label: 'Contracts', icon: ScrollText },
  { to: '/claims', label: 'Claims / EOT', icon: ShieldAlert },
  { to: '/subcontracts', label: 'Subcontracts', icon: HardHat },
  { to: '/cost-control', label: 'Cost Control', icon: Landmark },
  { to: '/procurement', label: 'Procurement', icon: PackageCheck },
  { to: '/inventory', label: 'Inventory', icon: PackageCheck },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { to: '/finance', label: 'Finance', icon: Landmark },
  { to: '/technical-office', label: 'Technical Office', icon: DraftingCompass },
  { to: '/planning', label: 'Planning', icon: CalendarDays },
  { to: '/site', label: 'Site Execution', icon: HardHat },
  { to: '/hr', label: 'HR / Payroll', icon: UsersRound },
  { to: '/assets', label: 'Assets', icon: Wrench },
  { to: '/qaqc', label: 'QA/QC', icon: ShieldCheck },
  { to: '/hse', label: 'HSE', icon: ShieldAlert },
  { to: '/edms', label: 'EDMS', icon: FolderArchive },
  { to: '/executive-dashboard', label: 'Executive Dashboard', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/portals', label: 'Portals', icon: Globe2 },
  { to: '/runtime-validation', label: 'Runtime Validation', icon: MonitorCheck },
  { to: '/ai-platform', label: 'AI Platform', icon: Bot },
  { to: '/automation', label: 'Automation / Integrations', icon: Workflow },
  { to: '/knowledge', label: 'Knowledge / RAG', icon: BookOpenCheck },
  { to: '/commercial-platform', label: 'Commercial SaaS', icon: BadgeDollarSign }
];

export function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">ERP</span>
          <div>
            <strong>Construction ERP</strong>
            <small>Fit-Out Execution OS</small>
          </div>
        </div>
        <nav>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      <button className="logout" onClick={async () => { await logout(); window.location.href = '/login'; }}>Logout</button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
