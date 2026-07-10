import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";
import AzureConnectionForm from "../components/common/AzureConnectionForm.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function AzureSetup() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 gap-3 text-center px-3 py-5">
      <ReactorLogo size={64} />
      <h2 className="fw-bold mb-0">{t("onboarding.welcomeTitle", { name: profile?.fullName || t("onboarding.fallbackName") })}</h2>
      <p className="text-muted mb-2" style={{ maxWidth: 480 }}>
        {t("onboarding.welcomeSubtitle")}
      </p>
      <div className="stark-card text-start" style={{ width: "100%", maxWidth: 440 }}>
        <AzureConnectionForm submitLabel={t("onboarding.testAndContinue")} onSuccess={() => navigate("/profile-setup", { replace: true })} />
      </div>
      <button type="button" className="btn btn-link btn-sm text-muted" onClick={signOut}>{t("onboarding.signOut")}</button>
    </div>
  );
}
