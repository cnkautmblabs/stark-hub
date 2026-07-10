import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FiBarChart2,
  FiCheckSquare,
  FiChevronsLeft,
  FiChevronsRight,
  FiClipboard,
  FiGitBranch,
  FiHelpCircle,
  FiHome,
  FiInfo,
  FiMoon,
  FiSettings,
  FiShield,
  FiSun,
  FiUsers
} from "react-icons/fi";
import ReactorLogo from "./ReactorLogo.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useTheme } from "../../contexts/ThemeContext.jsx";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { accessLevels } from "../../utils/constants.js";

const navByRole = {
  [accessLevels.dev]: [
    { to: "/dev", labelKey: "nav.myItems", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management/collaborators", labelKey: "nav.profile", icon: FiUsers, flag: "showGovernance" }
  ],
  [accessLevels.qa]: [
    { to: "/qa", labelKey: "nav.qualityBoard", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", labelKey: "nav.myItems", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", labelKey: "nav.myMetrics", icon: FiShield, flag: "showGovernance" },
    { to: "/management/collaborators", labelKey: "nav.profile", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", labelKey: "nav.importWorkItems", icon: FiGitBranch, flag: "showImportWorkItems" }
  ],
  [accessLevels.gestao]: [
    { to: "/qa", labelKey: "nav.qualityBoard", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", labelKey: "nav.myItems", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", labelKey: "nav.teamManagement", icon: FiShield, flag: "showGovernance" },
    { to: "/management/collaborators", labelKey: "nav.profile", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", labelKey: "nav.importWorkItems", icon: FiGitBranch, flag: "showImportWorkItems" }
  ],
  [accessLevels.gerente]: [
    { to: "/qa", labelKey: "nav.qualityBoard", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", labelKey: "nav.myItems", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", labelKey: "nav.teamManagement", icon: FiShield, flag: "showGovernance" },
    { to: "/management/dashboard", labelKey: "nav.projectManagement", icon: FiBarChart2, flag: "showGovernance" },
    { to: "/management/collaborators", labelKey: "nav.profile", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", labelKey: "nav.importWorkItems", icon: FiGitBranch, flag: "showImportWorkItems" }
  ]
};

export default function Sidebar({ collapsed, onToggle }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled } = useFeatureFlags();
  const accessLevel = profile?.accessLevel;
  // Admin enxerga tudo de todos os niveis — usa o menu do Gerente (o mais
  // completo: Quality Board, Meus itens, Gestao da equipe/projeto, Perfil,
  // Import Work Items) independente do accessLevel formal da pessoa.
  const items = (profile?.isAdmin ? navByRole[accessLevels.gerente] : navByRole[accessLevel] || []).filter((item) => isEnabled(item.flag));
  const ThemeIcon = theme === "dark" ? FiSun : FiMoon;

  return (
    <aside className={`stark-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="stark-sidebar-brand">
        <ReactorLogo size={28} />
        {!collapsed && <span>Stark Hub</span>}
      </div>

      <nav className="flex-grow-1 py-2">
        <NavLink to="/" end className="stark-nav-link" title={t("nav.home")}>
          <FiHome /> <span className="stark-nav-label">{t("nav.home")}</span>
        </NavLink>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/management"} className="stark-nav-link" title={t(item.labelKey)}>
            <item.icon /> <span className="stark-nav-label">{t(item.labelKey)}</span>
          </NavLink>
        ))}
        <hr className="mx-3" />
        <NavLink to="/settings" className="stark-nav-link" title={t("nav.settings")}>
          <FiSettings /> <span className="stark-nav-label">{t("nav.settings")}</span>
        </NavLink>
        {isEnabled("showThemeToggle") && (
          <button type="button" className="stark-nav-link stark-nav-button" onClick={toggleTheme} title={t("nav.theme")}>
            <ThemeIcon /> <span className="stark-nav-label">{t("nav.theme")}</span>
          </button>
        )}
        <NavLink to="/faq" className="stark-nav-link" title={t("nav.faq")}>
          <FiHelpCircle /> <span className="stark-nav-label">{t("nav.faq")}</span>
        </NavLink>
        <NavLink to="/about" className="stark-nav-link" title={t("nav.about")}>
          <FiInfo /> <span className="stark-nav-label">{t("nav.about")}</span>
        </NavLink>
      </nav>

      <button
        type="button"
        className="stark-sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
      >
        {collapsed ? <FiChevronsRight /> : <FiChevronsLeft />}
      </button>
    </aside>
  );
}

