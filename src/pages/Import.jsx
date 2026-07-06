import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiUpload, FiDownload } from "react-icons/fi";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useWorkItems } from "../hooks/useWorkItems.js";
import { useHierarchyImport } from "../hooks/useHierarchyImport.js";
import { useAppSettings } from "../hooks/useAppSettings.js";
import WorkItemTypeIcon from "../components/common/WorkItemTypeIcon.jsx";
import {
  looksLikeCsv,
  parseCsv,
  csvRowsToObjects,
  buildTreeFromCsvRows,
  findFirstConfigSource,
  countNodes
} from "../utils/hierarchyImport.js";

const SAMPLE_CSV = `"Work Item Type","Title 1","Title 2","Title 3","Title 4","Area Path","Iteration Path","Country","Tags","Description"
"Epic","Meu Epic",,,,"MeuProjeto\\Time","MeuProjeto","All","0-LT; QA",""
"Feature",,"Minha Feature",,,"MeuProjeto\\Time","MeuProjeto","All","0-LT; QA",""
"Test Case",,,,"Meu caso de teste","MeuProjeto\\Time","MeuProjeto","All","0-LT; QA","**Objetivo:** validar X.

**Steps:**
1. Passo 1
2. Passo 2

**Expected Result:** Resultado esperado."`;

function TreePreview({ node }) {
  if (node.type === "root") {
    return <>{node.children.map((child, i) => <TreePreview key={i} node={child} />)}</>;
  }
  return (
    <div className="ms-3 border-start ps-2 mb-1">
      <div className="d-flex align-items-center gap-2">
        <WorkItemTypeIcon type={node.type} />
        <span className="badge text-bg-secondary">{node.type}</span>
        <span>{node.title}</span>
        {node.opts?.stepsXml && <span className="badge text-bg-info">passos preenchidos</span>}
      </div>
      {node.children.map((child, i) => <TreePreview key={i} node={child} />)}
    </div>
  );
}

// Importação hierárquica — mesmo fluxo do userscript legado: cola/anexa um
// CSV no formato do importador nativo do Azure Boards, mas cria os itens
// via API própria (funciona também para "Test Case", que o importador
// nativo do Azure bloqueia).
export default function Import() {
  const { profile, demoMode } = useAuth();
  const { items, reload } = useWorkItems();
  const { runImport, importing, result } = useHierarchyImport();
  const { getSetting } = useAppSettings();
  const fileInputRef = useRef(null);

  const [raw, setRaw] = useState("");
  const [tree, setTree] = useState(null);
  const [areaPath, setAreaPath] = useState(profile?.azureTeam ? `${profile.azureProject}\\${profile.azureTeam}` : "");
  const [iterationPath, setIterationPath] = useState(profile?.azureProject || "");
  const [countryField, setCountryField] = useState(() => getSetting("azureCountryField", ""));
  const [error, setError] = useState("");

  const counts = useMemo(() => (tree ? countNodes(tree) : {}), [tree]);
  const savedCountryField = getSetting("azureCountryField", "");

  useEffect(() => {
    if (savedCountryField) setCountryField(savedCountryField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCountryField]);

  function parseInput() {
    setError("");
    if (!looksLikeCsv(raw)) {
      setError('Formato não reconhecido. O CSV precisa começar com o cabeçalho "Work Item Type","Title 1",...');
      setTree(null);
      return;
    }
    const rows = parseCsv(raw);
    if (rows.length < 2) {
      setError("Nenhuma linha de dados encontrada.");
      setTree(null);
      return;
    }
    const objects = csvRowsToObjects(rows);
    const parsedTree = buildTreeFromCsvRows(objects);
    if (!parsedTree.children.length) {
      setError("Nenhum item reconhecido no CSV.");
      setTree(null);
      return;
    }
    const source = findFirstConfigSource(parsedTree);
    if (source?.opts.areaPath) setAreaPath(source.opts.areaPath);
    if (source?.opts.iterationPath) setIterationPath(source.opts.iterationPath);
    setTree(parsedTree);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setRaw(String(reader.result || "")); };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  async function handleImport() {
    if (!tree || demoMode) return;
    await runImport(tree, { areaPath, iterationPath, countryField: countryField.trim() || undefined });
    reload();
  }

  function exportItemsCsv() {
    const rows = [
      ["ID", "Tipo", "Título", "Status", "Ambiente", "Países", "Sprint", "Responsável", "Horas"],
      ...items.map((item) => [
        item.id, item.type, item.title, item.state, item.env,
        (item.countries || []).join("|"), item.sprint || "", item.assigneeId || "", item.completedHours ?? ""
      ])
    ];
    const csv = "﻿" + rows.map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stark-hub-work-items-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h3 className="mb-0">Importar / Exportar {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={exportItemsCsv}>
          <FiDownload /> Exportar work items (CSV)
        </button>
      </div>

      {demoMode && (
        <div className="alert alert-warning py-2 small mb-0">Importação real indisponível no modo demonstração.</div>
      )}

      <div className="stark-card">
        <h5 className="mb-2">Importação hierárquica (Epic → Feature → User Story → Task → Test Case)</h5>
        <p className="text-muted small">
          Cole ou anexe o mesmo CSV usado no importador nativo do Azure Boards. Funciona também para Test Case
          (que o importador nativo do Azure bloqueia) — os passos são extraídos automaticamente da Description
          (blocos <code>**Steps:**</code> / <code>**Expected Result:**</code>).
        </p>
        <div className="d-flex gap-2 mb-2">
          <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={() => fileInputRef.current?.click()}>
            <FiUpload /> Selecionar arquivo CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setRaw(SAMPLE_CSV)}>Usar exemplo</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={parseInput}>Gerar prévia</button>
        </div>
        <textarea
          className="form-control mb-2" rows={8} style={{ fontFamily: "monospace", fontSize: 12 }}
          placeholder="Cole aqui o CSV exportado do Azure Boards..."
          value={raw} onChange={(e) => setRaw(e.target.value)}
        />

        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        {tree && (
          <>
            <div className="row g-2 mb-2">
              <div className="col-md-4">
                <label className="form-label small mb-1">Area Path (fallback)</label>
                <input className="form-control form-control-sm" value={areaPath} onChange={(e) => setAreaPath(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label small mb-1">Iteration Path (fallback)</label>
                <input className="form-control form-control-sm" value={iterationPath} onChange={(e) => setIterationPath(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label small mb-1">Campo "Country" no processo (opcional)</label>
                <input className="form-control form-control-sm" placeholder="ex: Custom.Country" value={countryField} onChange={(e) => setCountryField(e.target.value)} />
              </div>
            </div>

            <div className="small text-muted mb-2">
              {Object.entries(counts).map(([type, count]) => `${count} ${type}(s)`).join(" · ") || "Nenhum item reconhecido."}
            </div>
            <div className="border rounded p-2 mb-2" style={{ maxHeight: 260, overflow: "auto" }}>
              <TreePreview node={tree} />
            </div>

            <button type="button" className="btn btn-primary" disabled={importing || demoMode} onClick={handleImport}>
              {importing ? "Importando..." : "Importar no Azure DevOps"}
            </button>
          </>
        )}

        {result && (
          <div className={`alert ${result.ok ? "alert-success" : "alert-danger"} mt-3 py-2 small mb-0`}>
            {result.ok ? (
              <>
                <div className="mb-1">
                  {Object.entries(result.counts || {}).filter(([k]) => k !== "errors").map(([type, count]) => `${count} ${type}(s)`).join(" · ")}
                  {result.counts?.errors ? ` · ${result.counts.errors} erro(s)` : ""}
                </div>
                <pre className="mb-0" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{(result.log || []).join("\n")}</pre>
              </>
            ) : (
              result.error
            )}
          </div>
        )}
      </div>
    </div>
  );
}
