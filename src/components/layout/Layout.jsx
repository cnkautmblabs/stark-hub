import React, { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FiLogOut, FiUser } from "react-icons/fi";
import Sidebar from "./Sidebar.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { accessLevelLabels, accessLevels } from "../../utils/constants.js";
import { normalize } from "../../utils/workbench/formatters.js";
import { IdentityAvatar } from "../workbench/ui/WorkbenchPrimitives.jsx";
import { BrowserNotificationWatcher } from "../common/BrowserNotificationWatcher.jsx";
import { LanguageSwitcher } from "../common/LanguageSwitcher.jsx";
import { NotificationBell } from "../common/NotificationBell.jsx";

function MBLabsMark() {
  const base = import.meta.env.BASE_URL;
  return (
    <picture className="stark-mblabs-mark">
      <img className="stark-mblabs-mark-dark" src={`${base}icons/mblabs-branco.png`} alt="mb.labs" />
      <img className="stark-mblabs-mark-light" src={`${base}icons/mblabs-preto.png`} alt="mb.labs" />
    </picture>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("starkHubSidebarCollapsed") === "1");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { profile, user, demoMode, signOut, isRealAdmin, viewAsRole, setViewAsRole } = useAuth();
  const { collaborators } = useCollaborators();
  const displayName = profile?.displayName || profile?.fullName || user?.email || "Stark Hub";
  const email = profile?.email || user?.email || (demoMode ? "modo.demo@starkhub.local" : "");
  const profileCollaborator = collaborators.find((person) => person.id === profile?.id)
    || collaborators.find((person) => person.email && email && normalize(person.email) === normalize(email))
    || collaborators.find((person) => normalize(person.azureName) && normalize(person.azureName) === normalize(displayName));
  const avatarUrl = profile?.imageUrl || profileCollaborator?.imageUrl || profile?.avatarUrl || "";
  const avatarColor = profile?.color || profileCollaborator?.color;
  const isAdmin = Boolean(profile?.isAdmin || profile?.accessLevel === accessLevels.admin);
  const accessLabel = isAdmin && profile?.accessLevel && profile?.accessLevel !== accessLevels.admin
    ? `${accessLevelLabels[profile.accessLevel] || profile.accessLevel} (Admin)`
    : accessLevelLabels[profile?.accessLevel] || t("topbar.accessFallback");

  function handleToggle() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("starkHubSidebarCollapsed", next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    setUserMenuOpen(false);
    await signOut();
  }

  return (
    <div className={`workbench-app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <BrowserNotificationWatcher />
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <div className="workbench-main-area">
        <header className="stark-app-topbar">
          <div className="stark-topbar-title">
            <span>Stark Hub</span>
            <small>{accessLabel}</small>
          </div>
          {isRealAdmin && (
            <label className="stark-admin-sandbox" title={t("topbar.sandboxTitle")}>
              <i className="bi bi-eye" />
              <select value={viewAsRole || ""} onChange={(event) => setViewAsRole(event.target.value || null)}>
                <option value="">{t("topbar.viewAsAdmin")}</option>
                <option value={accessLevels.dev}>{t("topbar.viewAsDev")}</option>
                <option value={accessLevels.qa}>{t("topbar.viewAsQa")}</option>
                <option value={accessLevels.gestao}>{t("topbar.viewAsGestao")}</option>
                <option value={accessLevels.gerente}>{t("topbar.viewAsGerente")}</option>
              </select>
            </label>
          )}
          <NotificationBell />
          <div className="stark-user-menu-wrap">
            <button type="button" className="stark-user-menu-trigger" onClick={() => setUserMenuOpen((value) => !value)} aria-expanded={userMenuOpen}>
              <IdentityAvatar name={displayName} imageUrl={avatarUrl} color={avatarColor} accessLevel={profile?.accessLevel} size={36} />
              <span className="stark-user-menu-text">
                <strong>{displayName}</strong>
                <small>{email}</small>
              </span>
            </button>
            {userMenuOpen && (
              <div className="stark-user-menu">
                <div className="stark-user-menu-level">{t("topbar.accessLevelPrefix")}: <b>{accessLabel}</b></div>
                <Link to="/management/collaborators" onClick={() => setUserMenuOpen(false)}><FiUser /> {t("nav.profile")}</Link>
                <LanguageSwitcher />
                <button type="button" onClick={handleSignOut}><FiLogOut /> {demoMode ? t("topbar.signOutDemo") : t("topbar.signOut")}</button>
              </div>
            )}
          </div>
        </header>
        <main id="mb-workbench-content" className="workbench-content" aria-label="Conteudo do Stark Hub" onClick={() => userMenuOpen && setUserMenuOpen(false)}>
          <Outlet />
        </main>
        <footer className="stark-app-footer">
          <span>{t("common.footerPrefix")} <img className="stark-footer-brand-logo" src={`${import.meta.env.BASE_URL}icons/Bonotto-logo-branco.png`} alt="" /> <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a> {t("common.footerSuffix")} <MBLabsMark />.</span>
        </footer>
      </div>
    </div>
  );
}
