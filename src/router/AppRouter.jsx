import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "../components/layout/Layout.jsx";
import Login from "../pages/Login.jsx";
import PendingApproval from "../pages/PendingApproval.jsx";
import AzureSetup from "../pages/AzureSetup.jsx";
import DevDashboard from "../pages/dev/DevDashboard.jsx";
import QaBoard from "../pages/qa/QaBoard.jsx";
import Governance from "../pages/management/Governance.jsx";
import Collaborators from "../pages/management/Collaborators.jsx";
import Settings from "../pages/Settings.jsx";
import Faq from "../pages/Faq.jsx";
import About from "../pages/About.jsx";
import ProtectedRoute from "./ProtectedRoute.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

function Home() {
  const { profile } = useAuth();
  const accessLevel = profile?.accessLevel;
  if (accessLevel === "qa") return <Navigate to="/qa" replace />;
  if (accessLevel === "gestao") return <Navigate to="/management" replace />;
  return <Navigate to="/dev" replace />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pending" element={<PendingApproval />} />
      <Route path="/azure-setup" element={<AzureSetup />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Home />} />
        <Route path="/dev" element={<ProtectedRoute allow={["dev", "gestao"]}><DevDashboard /></ProtectedRoute>} />
        <Route path="/qa" element={<ProtectedRoute allow={["qa", "gestao"]}><QaBoard /></ProtectedRoute>} />
        <Route path="/management" element={<ProtectedRoute allow={["gestao"]}><Governance /></ProtectedRoute>} />
        <Route path="/management/collaborators" element={<ProtectedRoute allow={["gestao"]}><Collaborators /></ProtectedRoute>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/about" element={<About />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
