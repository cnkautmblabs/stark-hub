import React from "react";
import { FiX } from "react-icons/fi";

// Abre o card/tarefa em um iframe embutido, evitando a necessidade de
// sair da página para acompanhar/realizar o teste (substitui a antiga
// abertura do Azure DevOps em nova aba).
export default function IframeTaskModal({ url, title, onClose }) {
  if (!url) return null;
  return (
    <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: "rgba(0,0,0,.55)", zIndex: 1050 }}>
      <div className="stark-card d-flex flex-column" style={{ width: "min(1100px, 94vw)", height: "min(760px, 90vh)", padding: 0, overflow: "hidden" }}>
        <div className="d-flex align-items-center justify-content-between p-2 border-bottom">
          <strong className="ps-2">{title}</strong>
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose}><FiX /></button>
        </div>
        <iframe src={url} title={title} style={{ flex: 1, border: 0 }} />
      </div>
    </div>
  );
}
