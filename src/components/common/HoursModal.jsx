import React, { useState } from "react";
import { FiX } from "react-icons/fi";

// Exige horas trabalhadas antes de confirmar um avanço de status — mesmo
// padrão do fluxo original ("Horas trabalhadas neste avanço *", mínimo 0.25).
export default function HoursModal({ title, confirmLabel = "Confirmar", allowStatusToggle = false, onConfirm, onClose }) {
  const [hours, setHours] = useState("");
  const [changeStatus, setChangeStatus] = useState(true);
  const valid = Number(hours) >= 0.25;

  function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    onConfirm(Number(hours), changeStatus);
  }

  return (
    <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: "rgba(0,0,0,.55)", zIndex: 1060 }}>
      <form className="stark-card" style={{ width: "min(380px, 92vw)" }} onSubmit={handleSubmit}>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <strong>{title}</strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}><FiX /></button>
        </div>
        <label className="form-label small text-muted">Horas trabalhadas neste avanço *</label>
        <input
          type="number" min="0.25" step="0.25" className="form-control mb-3"
          value={hours} onChange={(e) => setHours(e.target.value)} autoFocus required
        />
        {allowStatusToggle && (
          <label className="d-flex align-items-center gap-2 small mb-3">
            <input type="checkbox" checked={changeStatus} onChange={(e) => setChangeStatus(e.target.checked)} />
            Também alterar o status
          </label>
        )}
        <button type="submit" className="btn btn-primary w-100" disabled={!valid}>{confirmLabel}</button>
      </form>
    </div>
  );
}
