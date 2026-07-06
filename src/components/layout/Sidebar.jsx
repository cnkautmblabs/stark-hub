import React from "react";
import { NavLink } from "react-router-dom";
import {
  FiHome, FiClipboard, FiCheckSquare, FiSettings, FiHelpCircle, FiInfo,
  FiChevronsLeft, FiChevronsRight, FiUsers, FiShield, FiUploadCloud
} from "react-icons/fi";
import ReactorLogo from "./ReactorLogo.jsx";
import BrandFooter from "./BrandFooter.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { accessLevels } from "../../utils/constants.js";

const navByRole = {
  [accessLevels.dev]: [
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" }
  ],
  [accessLevels.qa]: [
    { to: "/qa", label: "QA Board", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/import", label: "Importar/Exportar", icon: FiUploadCloud }
  ],
  [accessLevels.gestao]: [
    { to: "/dev", label: "Meus itens", icon: FiClipboard, flag: "showMyItems" },
    { to: "/qa", label: "QA Board", icon: FiCheckSquare, flag: "showQaBoard" },
    { to: "/management", label: "Governança", icon: FiShield, flag: "showGovernance" },
    { to: "/management/collaborators", label: "Colaboradores", icon: FiUsers, flag: "showGovernance" },
    { to: "/import", label: "Importar/Exportar", icon: FiUploadCloud }
  ]
};

export default function Sidebar({ collapsed, onToggle }) {
  const { profile } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const accessLevel = profile?.accessLevel;
  const items = (navByRole[accessLevel] || []).filter((item) => isEnabled(item.flag));

  return (
    <aside className={`stark-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="stark-sidebar-brand">
        <ReactorLogo size={28} />
        {!collapsed && <span>Stark Hub</span>}
      </div>

      <nav className="flex-grow-1 py-2">
        <NavLink to="/" end className="stark-nav-link">
          <FiHome /> <span className="stark-nav-label">Início</span>
        </NavLink>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/management"} className="stark-nav-link">
            <item.icon /> <span className="stark-nav-label">{item.label}</span>
          </NavLink>
        ))}
        <hr className="mx-3" />
        <NavLink to="/settings" className="stark-nav-link">
          <FiSettings /> <span className="stark-nav-label">Configurações</span>
        </NavLink>
        <NavLink to="/faq" className="stark-nav-link">
          <FiHelpCircle /> <span className="stark-nav-label">FAQ</span>
        </NavLink>
        <NavLink to="/about" className="stark-nav-link">
          <FiInfo /> <span className="stark-nav-label">Sobre</span>
        </NavLink>
      </nav>

      <BrandFooter collapsed={collapsed} />

      <button
        type="button"
        className="btn btn-sm btn-link text-decoration-none m-2"
        onClick={onToggle}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        {collapsed ? <FiChevronsRight /> : <FiChevronsLeft />}
      </button>
    </aside>
  );
}
