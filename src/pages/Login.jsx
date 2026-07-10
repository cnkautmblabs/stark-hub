import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext.jsx";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";
import BrandFooter from "../components/layout/BrandFooter.jsx";
import { FiAlertTriangle } from "react-icons/fi";
import { allowedEmailDomains, accessLevelLabels } from "../utils/constants.js";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";

const demoRoles = ["dev", "qa", "gestao", "gerente"];

const particles = [
  { left: "6%", duration: "9s", delay: "0s" },
  { left: "16%", duration: "12s", delay: "2s" },
  { left: "27%", duration: "10s", delay: "4s" },
  { left: "40%", duration: "14s", delay: "1s" },
  { left: "53%", duration: "11s", delay: "5s" },
  { left: "66%", duration: "13s", delay: "3s" },
  { left: "78%", duration: "9s", delay: "6s" },
  { left: "90%", duration: "12s", delay: "0.5s" }
];

export default function Login() {
  const { t } = useTranslation();
  const { signInWithGoogle, enterDemoMode, demoMode, user, oauthError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (demoMode || user) navigate("/", { replace: true });
  }, [demoMode, user, navigate]);

  function handleDemoSelect(e) {
    const role = e.target.value;
    if (role) enterDemoMode(role);
  }

  return (
    <div className="stark-login">
      <div className="stark-login-bg">
        <div className="stark-login-grid" />
        <div className="stark-login-glow" />
        <div className="stark-login-ring" />
        <div className="stark-login-ring" />
        <div className="stark-login-ring" />
        <div className="stark-login-scan" />
        {particles.map((p, i) => (
          <span
            key={i}
            className="stark-login-particle"
            style={{ left: p.left, animationDuration: p.duration, animationDelay: p.delay }}
          />
        ))}
      </div>

      <div className="stark-login-content d-flex flex-column align-items-center justify-content-center min-vh-100 gap-4 px-3 text-center">
        <ReactorLogo size={72} />
        <div>
          <h1 className="fw-bold mb-1 text-white">{t("login.title")}</h1>
          <p className="stark-text-cyan mb-0">{t("login.subtitle")}</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="alert alert-warning d-flex align-items-center gap-2" style={{ maxWidth: 480 }}>
            <FiAlertTriangle /> {t("login.supabaseNotConfigured")}
          </div>
        )}

        {oauthError && (
          <div className="alert alert-danger d-flex align-items-center gap-2" style={{ maxWidth: 480 }}>
            <FiAlertTriangle /> {t("login.loginFailed", { message: oauthError })}
          </div>
        )}

        <button className="btn btn-dark btn-lg d-flex align-items-center gap-2" onClick={signInWithGoogle} disabled={!isSupabaseConfigured}>
          <i className="bi bi-google" /> {t("login.signInGoogle")}
        </button>
        <p className="text-white-50 small mb-0" style={{ maxWidth: 420 }}>
          {allowedEmailDomains.length ? t("login.domainRestriction", { domains: allowedEmailDomains.join(" e ") }) : t("login.domainRestrictionMissing")}
          {" "}{t("login.waitForApproval")}
        </p>

        <div style={{ width: "100%", maxWidth: 300 }}>
          <select
            className="form-select"
            defaultValue=""
            onChange={handleDemoSelect}
            aria-label={t("login.demoModeLabel")}
          >
            <option value="" disabled>{t("login.demoModePlaceholder")}</option>
            {demoRoles.map((role) => (
              <option key={role} value={role}>{role === "gestao" ? t("collaborators.roleGestao") : role === "gerente" ? t("collaborators.roleGerente") : accessLevelLabels[role]}</option>
            ))}
          </select>
          <p className="stark-text-cyan small mt-2 mb-0">
            {t("login.demoModeHint")}
          </p>
        </div>

        <div className="stark-login-footer">
          <BrandFooter />
        </div>
      </div>
    </div>
  );
}
