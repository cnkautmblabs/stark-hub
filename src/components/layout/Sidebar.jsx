import React from "react";
import { NavLink } from "react-router-dom";
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
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management/collaborators", label: "Perfil", icon: FiUsers, flag: "showGovernance" }
  ],
  [accessLevels.qa]: [
    { to: "/qa", label: "Quality Board", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", label: "Minhas metricas", icon: FiShield, flag: "showGovernance" },
    { to: "/management/collaborators", label: "Perfil", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", label: "Import Work Items", icon: FiGitBranch, flag: "showImportWorkItems" }
  ],
  [accessLevels.gestao]: [
    { to: "/qa", label: "Quality Board", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", label: "Gestao da equipe", icon: FiShield, flag: "showGovernance" },
    { to: "/management/collaborators", label: "Perfil", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", label: "Import Work Items", icon: FiGitBranch, flag: "showImportWorkItems" }
  ],
  [accessLevels.gerente]: [
    { to: "/qa", label: "Quality Board", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" },
    { to: "/management", label: "Gestao da equipe", icon: FiShield, flag: "showGovernance" },
    { to: "/management/dashboard", label: "Gestao do projeto", icon: FiBarChart2, flag: "showGovernance" },
    { to: "/management/collaborators", label: "Perfil", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", label: "Import Work Items", icon: FiGitBranch, flag: "showImportWorkItems" }
  ]
};

export default function Sidebar({ collapsed, onToggle }) {
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
        <NavLink to="/" end className="stark-nav-link">
          <FiHome /> <span className="stark-nav-label">Inicio</span>
        </NavLink>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/management"} className="stark-nav-link">
            <item.icon /> <span className="stark-nav-label">{item.label}</span>
          </NavLink>
        ))}
        <hr className="mx-3" />
        <NavLink to="/settings" className="stark-nav-link">
          <FiSettings /> <span className="stark-nav-label">Configuracoes</span>
        </NavLink>
        {isEnabled("showThemeToggle") && (
          <button type="button" className="stark-nav-link stark-nav-button" onClick={toggleTheme}>
            <ThemeIcon /> <span className="stark-nav-label">Tema</span>
          </button>
        )}
        <NavLink to="/faq" className="stark-nav-link">
          <FiHelpCircle /> <span className="stark-nav-label">FAQ</span>
        </NavLink>
        <NavLink to="/about" className="stark-nav-link">
          <FiInfo /> <span className="stark-nav-label">Sobre</span>
        </NavLink>
      </nav>

      <button
        type="button"
        className="stark-sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        {collapsed ? <FiChevronsRight /> : <FiChevronsLeft />}
      </button>
    </aside>
  );
}

