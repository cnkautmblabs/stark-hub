import React, { useMemo, useRef, useState, useEffect } from "react";
import { FiChevronDown } from "react-icons/fi";

// Filtro multiseleção reutilizável em todo o projeto (país, sprint, status,
// colaborador, etc.). Replica o padrão do MB Azure Workbench: busca dentro
// da lista, ações "Todos"/"Limpar", e o rótulo do gatilho mostra até 2
// selecionados por extenso e resume o resto em "+N".
export default function MultiSelectFilter({ label, options, selected = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    function handleOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((item) => item.label.toLowerCase().includes(query));
  }, [options, search]);

  function toggleValue(value) {
    if (selected.includes(value)) onChange(selected.filter((item) => item !== value));
    else onChange([...selected, value]);
  }

  const triggerText = useMemo(() => {
    if (!selected.length) return label;
    const labels = new Map(options.map((item) => [item.value, item.label]));
    const selectedLabels = selected.map((value) => labels.get(value) || value);
    return selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`;
  }, [label, options, selected]);

  return (
    <div className="stark-dd" ref={rootRef}>
      <button
        type="button"
        className={`btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 stark-dd-trigger ${selected.length ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="stark-dd-trigger-label">{triggerText}</span>
        {selected.length > 0 && <span className="stark-dd-count">{selected.length}</span>}
        <FiChevronDown />
      </button>

      {open && (
        <div className="stark-card stark-dd-panel">
          <input
            ref={searchRef}
            className="form-control form-control-sm mb-2"
            placeholder={`Buscar ${label.toLowerCase()}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="stark-dd-list">
            {visibleOptions.map((option) => (
              <label key={option.value} className="stark-dd-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
            {!visibleOptions.length && <div className="text-muted small p-2">Nenhum resultado</div>}
          </div>
          <div className="stark-dd-actions">
            <button type="button" className="btn btn-sm btn-link p-0" onClick={() => onChange(options.map((o) => o.value))}>
              Todos
            </button>
            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={() => onChange([])}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
