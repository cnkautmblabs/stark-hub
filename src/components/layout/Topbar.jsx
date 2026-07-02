import React from "react";
import { FiSun, FiMoon, FiLogOut } from "react-icons/fi";
import { useTheme } from "../../contexts/ThemeContext.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { accessLevelLabels } from "../../utils/constants.js";

export default function Topbar() {
  const { theme, toggleTheme } = useTheme();
  const { profile, demoMode, signOut } = useAuth();
  const { isEnabled } = useFeatureFlags();

  return (
    <header className="stark-topbar">
      <div className="d-flex align-items-center gap-2">
        {demoMode && <span className="stark-badge-demo">MODO DEMONSTRAÇÃO</span>}
      </div>
      <div className="d-flex align-items-center gap-3">
        {profile && (
          <span className="small text-muted">
            {profile.displayName || profile.fullName} · {accessLevelLabels[profile.accessLevel] || "—"}
          </span>
        )}
        {isEnabled("showThemeToggle") && (
          <button className="btn btn-sm btn-outline-secondary" onClick={toggleTheme} title="Alternar tema">
            {theme === "dark" ? <FiSun /> : <FiMoon />}
          </button>
        )}
        <button className="btn btn-sm btn-outline-danger" onClick={signOut} title={demoMode ? "Sair do modo demonstração" : "Sair"}>
          <FiLogOut />
        </button>
      </div>
    </header>
  );
}
