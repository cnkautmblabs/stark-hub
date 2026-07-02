import React, { useRef, useState } from "react";
import { FiCamera } from "react-icons/fi";
import Avatar from "./Avatar.jsx";
import { supabase } from "../../lib/supabaseClient.js";
import { useAuth } from "../../contexts/AuthContext.jsx";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

// Foto de perfil do colaborador, usada nos cards do Dev/QA Board. Em modo
// real faz upload para o Storage do Supabase (bucket "avatars", público);
// em modo demo grava a imagem como data-URI no próprio localStorage, já que
// não há backend por trás — mas persiste normalmente entre reloads.
export default function AvatarUploader({ ownerId, name, imageUrl, color, size = 64, onUploaded }) {
  const { demoMode } = useAuth();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_SIZE_BYTES) {
      setError("Imagem muito grande (máx. 2MB).");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      if (demoMode) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        onUploaded(dataUrl);
      } else {
        const ext = file.name.split(".").pop();
        const path = `${ownerId}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        onUploaded(data.publicUrl);
      }
    } catch (err) {
      setError(err.message || "Falha ao enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="d-flex flex-column align-items-center gap-1">
      <button
        type="button"
        className="stark-avatar-upload"
        style={{ width: size, height: size }}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Alterar foto"
      >
        <Avatar name={name} imageUrl={imageUrl} color={color} size={size} />
        <span className="stark-avatar-upload-overlay"><FiCamera /></span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="d-none" onChange={handleFile} />
      {uploading && <span className="text-muted small">Enviando...</span>}
      {error && <span className="text-danger small">{error}</span>}
    </div>
  );
}
