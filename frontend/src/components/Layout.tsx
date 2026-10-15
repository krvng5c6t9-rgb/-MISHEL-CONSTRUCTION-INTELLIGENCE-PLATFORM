import { NavLink, Outlet } from 'react-router-dom';
import { logout } from '../lib/api';
import { LanguageSwitch, useI18n, type MessageKey } from '../lib/i18n';
import { Receipt, BarChart3, ClipboardCheck, FolderKanban, Landmark, PackageCheck, ScrollText, DraftingCompass, CalendarDays, HardHat, UsersRound, Wrench, ShieldCheck, ShieldAlert, FolderArchive, FileBarChart, MonitorCheck, Globe2, Bot, Workflow, BookOpenCheck, BadgeDollarSign } from 'lucide-react';

const navItems = [
  { to: '/', key: 'nav.dashboard', icon: BarChart3 },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban },
  { to: '/project-controls', key: 'nav.projectControls', icon: ShieldCheck },
  { to: '/payments-certification', key: 'nav.payments', icon: Receipt },
  { to: '/revenue-position', key: 'nav.revenue', icon: BadgeDollarSign },
  { to: '/cutover', key: 'nav.cutover', icon: BookOpenCheck },
  { to: '/users', key: 'nav.users', icon: UsersRound },
  { to: '/crm', key: 'nav.crm', icon: UsersRound },
  { to: '/tendering', key: 'nav.tendering', icon: ClipboardCheck },
  { to: '/boq', key: 'nav.boq', icon: ScrollText },
  { to: '/contracts', key: 'nav.contracts', icon: ScrollText },
  { to: '/claims', key: 'nav.claims', icon: ShieldAlert },
  { to: '/subcontracts', key: 'nav.subcontracts', icon: HardHat },
  { to: '/cost-control', key: 'nav.costControl', icon: Landmark },
  { to: '/procurement', key: 'nav.procurement', icon: PackageCheck },
  { to: '/inventory', key: 'nav.inventory', icon: PackageCheck },
  { to: '/approvals', key: 'nav.approvals', icon: ClipboardCheck },
  { to: '/finance', key: 'nav.finance', icon: Landmark },
  { to: '/technical-office', key: 'nav.technicalOffice', icon: DraftingCompass },
  { to: '/planning', key: 'nav.planning', icon: CalendarDays },
  { to: '/site', key: 'nav.site', icon: HardHat },
  { to: '/hr', key: 'nav.hr', icon: UsersRound },
  { to: '/assets', key: 'nav.assets', icon: Wrench },
  { to: '/qaqc', key: 'nav.qaqc', icon: ShieldCheck },
  { to: '/hse', key: 'nav.hse', icon: ShieldAlert },
  { to: '/edms', key: 'nav.edms', icon: FolderArchive },
  { to: '/executive-dashboard', key: 'nav.executiveDashboard', icon: BarChart3 },
  { to: '/reports', key: 'nav.reports', icon: FileBarChart },
  { to: '/portals', key: 'nav.portals', icon: Globe2 },
  { to: '/runtime-validation', key: 'nav.runtimeValidation', icon: MonitorCheck },
  { to: '/ai-platform', key: 'nav.aiPlatform', icon: Bot },
  { to: '/automation', key: 'nav.automation', icon: Workflow },
  { to: '/knowledge', key: 'nav.knowledge', icon: BookOpenCheck },
  { to: '/commercial-platform', key: 'nav.commercialPlatform', icon: BadgeDollarSign }
];

export function Layout() {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>{t('brand.name')}</strong>
            <small>{t('brand.tagline')}</small>
          </div>
        </div>
        <LanguageSwitch />
        <nav>
          {navItems.map(({ to, key, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{t(key as MessageKey)}</span>
            </NavLink>
          ))}
        </nav>
      <button className="logout" onClick={async () => { await logout(); window.location.href = '/login'; }}>{t('shell.logout')}</button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
