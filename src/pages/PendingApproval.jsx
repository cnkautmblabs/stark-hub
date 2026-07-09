import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";

export default function PendingApproval() {
  const { user, demoMode, profile, signOut } = useAuth();
  const navigate = useNavigate();

  // Esta pagina fica FORA do ProtectedRoute (nao faz sentido barrar por
  // isApproved a propria tela que explica que falta aprovacao), entao ela
  // precisa cuidar da propria navegacao — sem isso, clicar em "Sair" so
  // encerrava a sessao e deixava a pessoa presa aqui pra sempre (nada
  // redirecionava de volta pro login), bug relatado em producao.
  useEffect(() => {
    if (!demoMode && !user) navigate("/login", { replace: true });
  }, [demoMode, user, navigate]);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100 gap-3 text-center px-3">
      <ReactorLogo size={64} />
      <h2 className="fw-bold">Bem-vindo(a), {profile?.fullName || "colaborador(a)"}!</h2>
      <p className="text-muted" style={{ maxWidth: 420 }}>
        Sua conta foi criada com sucesso. Um administrador com nível de acesso de
        gestão precisa liberar seu nível de acesso (Dev, QA ou Gestão) antes que
        você possa continuar.
      </p>
      <button className="btn btn-outline-secondary" onClick={handleSignOut}>Sair</button>
    </div>
  );
}
