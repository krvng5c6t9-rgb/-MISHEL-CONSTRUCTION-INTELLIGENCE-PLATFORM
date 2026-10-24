import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { apiGet, logout } from '../lib/api';
import { LanguageSwitch, useI18n, type MessageKey } from '../lib/i18n';
import { ChevronDown, Receipt, BarChart3, ClipboardCheck, FolderKanban, Landmark, PackageCheck, ScrollText, DraftingCompass, CalendarDays, HardHat, UsersRound, Wrench, ShieldCheck, ShieldAlert, FolderArchive, FileBarChart, MonitorCheck, Globe2, Bot, Workflow, BookOpenCheck, BadgeDollarSign } from 'lucide-react';

// R1.3 (MP-06 §3, CC-081): navigation grouped as in MP-06 (groups without a screen yet are not listed: design studio,
// legal / risk / audit, facility management). An item is shown when the user holds 'view' on one of its permission
// modules (the module that guards the screen's main data); a group with no visible item is not shown. Hiding is for
// clarity only - every API still enforces its own permission. The home dashboard is always shown.
type Item = { to: string; key: MessageKey; icon: typeof BarChart3; perms?: string[] };
const navGroups: { key: MessageKey; items: Item[] }[] = [
  { key: 'nav.groupHome', items: [
    { to: '/', key: 'nav.dashboard', icon: BarChart3 },
    { to: '/approvals', key: 'nav.approvals', icon: ClipboardCheck, perms: ['approvals'] },
    { to: '/executive-dashboard', key: 'nav.executiveDashboard', icon: BarChart3, perms: ['dashboards'] }] },
  { key: 'nav.groupBusiness', items: [
    { to: '/crm', key: 'nav.crm', icon: UsersRound, perms: ['crm'] },
    { to: '/tendering', key: 'nav.tendering', icon: ClipboardCheck, perms: ['tendering'] },
    { to: '/boq', key: 'nav.boq', icon: ScrollText, perms: ['boq'] }] },
  { key: 'nav.groupCommercial', items: [
    { to: '/contracts', key: 'nav.contracts', icon: ScrollText, perms: ['contracts'] },
    { to: '/claims', key: 'nav.claims', icon: ShieldAlert, perms: ['contracts'] },
    { to: '/subcontracts', key: 'nav.subcontracts', icon: HardHat, perms: ['contracts'] },
    { to: '/payments-certification', key: 'nav.payments', icon: Receipt, perms: ['finance', 'contracts'] }] },
  { key: 'nav.groupProjects', items: [
    { to: '/projects', key: 'nav.projects', icon: FolderKanban, perms: ['projects'] },
    { to: '/project-controls', key: 'nav.projectControls', icon: ShieldCheck, perms: ['projects'] },
    { to: '/planning', key: 'nav.planning', icon: CalendarDays, perms: ['planning'] },
    { to: '/cost-control', key: 'nav.costControl', icon: Landmark, perms: ['cost_control'] },
    { to: '/reports', key: 'nav.reports', icon: FileBarChart, perms: ['reports'] }] },
  { key: 'nav.groupEngineering', items: [
    { to: '/technical-office', key: 'nav.technicalOffice', icon: DraftingCompass, perms: ['technical_office'] },
    { to: '/edms', key: 'nav.edms', icon: FolderArchive, perms: ['edms'] }] },
  { key: 'nav.groupSite', items: [
    { to: '/site', key: 'nav.site', icon: HardHat, perms: ['site'] }] },
  { key: 'nav.groupQuality', items: [
    { to: '/qaqc', key: 'nav.qaqc', icon: ShieldCheck, perms: ['qaqc'] },
    { to: '/hse', key: 'nav.hse', icon: ShieldAlert, perms: ['hse'] }] },
  { key: 'nav.groupSupply', items: [
    { to: '/procurement', key: 'nav.procurement', icon: PackageCheck, perms: ['procurement'] },
    { to: '/inventory', key: 'nav.inventory', icon: PackageCheck, perms: ['procurement'] },
    { to: '/assets', key: 'nav.assets', icon: Wrench, perms: ['assets'] }] },
  { key: 'nav.groupFinance', items: [
    { to: '/finance', key: 'nav.finance', icon: Landmark, perms: ['finance'] },
    { to: '/exchange', key: 'nav.exchange', icon: Landmark, perms: ['finance'] },
    { to: '/revenue-position', key: 'nav.revenue', icon: BadgeDollarSign, perms: ['finance'] },
    { to: '/cutover', key: 'nav.cutover', icon: BookOpenCheck, perms: ['finance'] }] },
  { key: 'nav.groupPeople', items: [
    { to: '/hr', key: 'nav.hr', icon: UsersRound, perms: ['hr'] }] },
  { key: 'nav.groupSystem', items: [
    { to: '/users', key: 'nav.users', icon: UsersRound, perms: ['admin'] },
    { to: '/portals', key: 'nav.portals', icon: Globe2, perms: ['portals'] },
    { to: '/runtime-validation', key: 'nav.runtimeValidation', icon: MonitorCheck, perms: ['system'] },
    { to: '/ai-platform', key: 'nav.aiPlatform', icon: Bot, perms: ['ai_platform'] },
    { to: '/automation', key: 'nav.automation', icon: Workflow, perms: ['automation'] },
    { to: '/knowledge', key: 'nav.knowledge', icon: BookOpenCheck, perms: ['knowledge'] },
    { to: '/commercial-platform', key: 'nav.commercialPlatform', icon: BadgeDollarSign, perms: ['commercial_platform'] }] }
];
const COLLAPSED_KEY = 'marc.nav.collapsed';
const readCollapsed = (): string[] => { try { const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

export function Layout() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  // null until known; if the permissions cannot be read every item is shown (the API refuses what the user may not see).
  const [viewable, setViewable] = useState<Set<string> | 'all' | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  useEffect(() => {
    apiGet<any>('/auth/me')
      .then(r => setViewable(new Set((r.data?.permissions ?? []).filter((p: any) => p.action === 'view').map((p: any) => p.module))))
      .catch(() => setViewable('all'));
  }, []);
  const shown = (i: Item) => !i.perms || viewable === 'all' || (viewable !== null && i.perms.some(m => viewable.has(m)));
  const toggle = (k: string) => setCollapsed(c => {
    const next = c.includes(k) ? c.filter(x => x !== k) : [...c, k];
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* not remembered; still toggles */ }
    return next;
  });
  const isCurrent = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
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
        <nav aria-label={t('nav.menu')}>
          {navGroups.map(g => {
            const items = g.items.filter(shown);
            if (!items.length) return null;
            // The group holding the current screen always stays open.
            const open = !collapsed.includes(g.key) || items.some(i => isCurrent(i.to));
            const id = `navgrp-${g.key.slice(4)}`;
            return (
              <div key={g.key} className="nav-group" data-group={g.key.slice(4)}>
                <button type="button" className="nav-group-toggle" aria-expanded={open} aria-controls={id} onClick={() => toggle(g.key)}>
                  <span>{t(g.key)}</span><ChevronDown size={16} aria-hidden="true" className={open ? 'open' : ''} />
                </button>
                {/* Named by its toggle (aria-controls); no label of its own, so it never competes with a page field's label. */}
                <div id={id} hidden={!open}>
                  {items.map(({ to, key, icon: Icon }) => (
                    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? 'active' : ''}`}>
                      <Icon size={18} />
                      <span>{t(key)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      <button className="logout" onClick={async () => { await logout(); window.location.href = '/login'; }}>{t('shell.logout')}</button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
