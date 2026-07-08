import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function ProtectedRoute({ children, allow }) {
  const { user, profile, demoMode, isApproved, loading } = useAuth();

  if (!demoMode && loading) return <div className="p-4 text-muted">Carregando...</div>;
  if (!demoMode && !user) return <Navigate to="/login" replace />;
  if (!isApproved) return <Navigate to="/pending" replace />;
  if (!demoMode && !profile?.azureVerifiedAt) return <Navigate to="/azure-setup" replace />;
  if (!demoMode && !(profile?.slackMemberId && profile?.aliasSlack && profile?.aliasAzure)) return <Navigate to="/profile-setup" replace />;

  const accessLevel = profile?.accessLevel;
  if (allow && !allow.includes(accessLevel)) return <Navigate to="/" replace />;

  return children;
}
