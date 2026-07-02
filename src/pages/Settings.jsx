import React from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { useCollaborators } from "../hooks/useCollaborators.js";
import { accessLevelLabels } from "../utils/constants.js";
import AzureConnectionForm from "../components/common/AzureConnectionForm.jsx";
import AvatarUploader from "../components/common/AvatarUploader.jsx";

export default function Settings() {
  const { user, profile, demoMode } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { collaborators, updateCollaborator } = useCollaborators();

  const displayName = profile?.fullName || user?.email || "—";
  const email = profile?.email || user?.email || "—";
  const accessLevel = profile?.accessLevel;
  const myCollaborator = collaborators.find((c) => c.profileId === profile?.id);

  return (
    <div className="stark-card" style={{ maxWidth: 640 }}>
      <h3>Configurações</h3>

      {demoMode && (
        <p className="text-muted small mb-4">
          Você está no modo demonstração. Conecte um projeto Supabase para editar dados reais.
        </p>
      )}

      <div className="mb-4">
        <h6 className="text-muted text-uppercase small mb-2">Perfil</h6>
        <div className="d-flex align-items-center gap-3 mb-3">
          {myCollaborator ? (
            <AvatarUploader
              ownerId={myCollaborator.profileId || myCollaborator.id}
              name={myCollaborator.azureName}
              imageUrl={myCollaborator.imageUrl}
              color={myCollaborator.color}
              size={56}
              onUploaded={(url) => updateCollaborator(myCollaborator.id, { imageUrl: url })}
            />
          ) : (
            <span className="text-muted small">Foto disponível assim que seu colaborador for cadastrado.</span>
          )}
        </div>
        <p className="mb-1"><strong>Nome:</strong> {displayName}</p>
        <p className="mb-1"><strong>E-mail:</strong> {email}</p>
        <p className="mb-0"><strong>Nível de acesso:</strong> {accessLevelLabels[accessLevel] || "—"}</p>
      </div>

      <div className="mb-4">
        <h6 className="text-muted text-uppercase small mb-2">Aparência</h6>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={toggleTheme}>
          Alternar para modo {theme === "dark" ? "claro" : "escuro"}
        </button>
      </div>

      {!demoMode && (
        <div>
          <h6 className="text-muted text-uppercase small mb-2">Integração Azure DevOps</h6>
          <AzureConnectionForm submitLabel="Testar e atualizar" />
        </div>
      )}
    </div>
  );
}
