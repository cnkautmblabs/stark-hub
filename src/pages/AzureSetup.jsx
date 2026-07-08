import React from "react";
import { useNavigate } from "react-router-dom";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";
import AzureConnectionForm from "../components/common/AzureConnectionForm.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function AzureSetup() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 gap-3 text-center px-3 py-5">
      <ReactorLogo size={64} />
      <h2 className="fw-bold mb-0">Bem-vindo(a), {profile?.fullName || "colaborador(a)"}!</h2>
      <p className="text-muted mb-2" style={{ maxWidth: 480 }}>
        Antes de continuar, conecte sua conta do Azure DevOps. Essa integração é
        obrigatória — é ela que alimenta os itens, tarefas e métricas do Stark Hub.
      </p>
      <div className="stark-card text-start" style={{ width: "100%", maxWidth: 440 }}>
        <AzureConnectionForm submitLabel="Testar e continuar" onSuccess={() => navigate("/profile-setup", { replace: true })} />
      </div>
      <button type="button" className="btn btn-link btn-sm text-muted" onClick={signOut}>Sair</button>
    </div>
  );
}
