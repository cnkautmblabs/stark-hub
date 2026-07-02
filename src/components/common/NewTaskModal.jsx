import React, { useState } from "react";
import { FiX } from "react-icons/fi";
import MultiSelectFilter from "./MultiSelectFilter.jsx";
import { countries } from "../../utils/constants.js";

export default function NewTaskModal({ onCreate, onClose }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Task");
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [sprint, setSprint] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      type,
      countries: selectedCountries,
      sprint: sprint.trim() || null,
      state: "In Dev",
      env: "dev",
      completedHours: null,
      assigneeId: null,
      qaCollaboratorId: null,
      lastTestResult: null
    });
  }

  return (
    <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: "rgba(0,0,0,.55)", zIndex: 1060 }}>
      <form className="stark-card" style={{ width: "min(420px, 92vw)" }} onSubmit={handleSubmit}>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <strong>Nova tarefa</strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}><FiX /></button>
        </div>

        <label className="form-label small text-muted">Título *</label>
        <input className="form-control mb-3" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />

        <label className="form-label small text-muted">Tipo</label>
        <select className="form-select mb-3" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="Task">Task</option>
          <option value="Bug">Bug</option>
          <option value="Feature">Feature</option>
        </select>

        <label className="form-label small text-muted">Sprint</label>
        <input className="form-control mb-3" placeholder="Sprint 25" value={sprint} onChange={(e) => setSprint(e.target.value)} />

        <label className="form-label small text-muted d-block mb-1">Países</label>
        <div className="mb-3">
          <MultiSelectFilter
            label="País"
            selected={selectedCountries}
            onChange={setSelectedCountries}
            options={Object.entries(countries).map(([value, c]) => ({ value, label: `${value} - ${c.label}` }))}
          />
        </div>

        <button type="submit" className="btn btn-primary w-100">Criar</button>
      </form>
    </div>
  );
}
