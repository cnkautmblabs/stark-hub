import React from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";

export default function PendingApproval() {
  const { profile, signOut } = useAuth();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100 gap-3 text-center px-3">
      <ReactorLogo size={64} />
      <h2 className="fw-bold">Bem-vindo(a), {profile?.fullName || "colaborador(a)"}!</h2>
      <p className="text-muted" style={{ maxWidth: 420 }}>
        Sua conta foi criada com sucesso. Um administrador com nível de acesso de
        gestão precisa liberar seu nível de acesso (Dev, QA ou Gestão) antes que
        você possa continuar.
      </p>
      <button className="btn btn-outline-secondary" onClick={signOut}>Sair</button>
    </div>
  );
}
