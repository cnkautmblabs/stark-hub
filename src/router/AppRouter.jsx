import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "../components/layout/Layout.jsx";
import Login from "../pages/Login.jsx";
import PendingApproval from "../pages/PendingApproval.jsx";
import AzureSetup from "../pages/AzureSetup.jsx";
import ProfileSetup from "../pages/ProfileSetup.jsx";
import DevDashboard from "../pages/dev/DevDashboard.jsx";
import QaBoard from "../pages/qa/QaBoard.jsx";
import Governance from "../pages/management/Governance.jsx";
import Collaborators from "../pages/management/Collaborators.jsx";
import Import from "../pages/Import.jsx";
import Settings from "../pages/Settings.jsx";
import Faq from "../pages/Faq.jsx";
import About from "../pages/About.jsx";
import ProtectedRoute from "./ProtectedRoute.jsx";
import WorkbenchHome from "../pages/WorkbenchHome.jsx";

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pending" element={<PendingApproval />} />
      <Route path="/azure-setup" element={<AzureSetup />} />
      <Route path="/profile-setup" element={<ProfileSetup />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<WorkbenchHome />} />
        <Route path="/dev" element={<ProtectedRoute allow={["dev", "qa", "gestao"]}><DevDashboard /></ProtectedRoute>} />
        <Route path="/qa" element={<ProtectedRoute allow={["qa", "gestao"]}><QaBoard /></ProtectedRoute>} />
        <Route path="/tests" element={<Navigate to="/dev" replace />} />
        <Route path="/management" element={<ProtectedRoute allow={["gestao"]}><Governance /></ProtectedRoute>} />
        <Route path="/management/collaborators" element={<ProtectedRoute allow={["dev", "qa", "gestao"]}><Collaborators /></ProtectedRoute>} />
        <Route path="/import" element={<ProtectedRoute allow={["qa", "gestao"]}><Import /></ProtectedRoute>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/about" element={<About />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
