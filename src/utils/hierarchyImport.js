// Parsing do CSV hierárquico — mesmo formato aceito pelo importador nativo
// do Azure Boards ("Work Item Type","Title 1..N","Area Path","Iteration
// Path","Country","Tags","Description"), portado do userscript legado
// (MÓDULO — IMPORTAÇÃO HIERÁRQUICA). A profundidade de cada linha é
// definida pela POSIÇÃO da coluna "Title N" preenchida, não pelo nome do
// tipo — por isso funciona para qualquer profundidade (Epic > Feature >
// User Story > Task > Test Case, ou menos níveis).

export function looksLikeCsv(raw) {
  const firstLine = String(raw || "").replace(/^﻿/, "").split("\n").find((l) => l.trim());
  return Boolean(firstLine) && /^"?\s*work item type\s*"?\s*,/i.test(firstLine.trim());
}

// Parser RFC4180: respeita aspas, vírgulas e quebras de linha dentro de células.
export function parseCsv(text) {
  const s = String(text || "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

export function csvRowsToObjects(rows) {
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ""; });
    return obj;
  });
}

// Extrai passos e resultado esperado de uma Description no padrão
// "**Steps:**\n1. ...\n2. ...\n\n**Expected Result:** ..." (Test Cases).
export function extractStepsFromDescription(description) {
  const text = String(description || "");
  const blocks = text.split(/\n\s*\n/);
  let steps = [];
  let expected = "";
  blocks.forEach((block) => {
    const trimmed = block.trim();
    if (/^\*\*Steps:?\*\*/i.test(trimmed)) {
      const rest = trimmed.replace(/^\*\*Steps:?\*\*/i, "").trim();
      steps = rest.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\d+[.)]\s*/, ""));
    } else if (/^\*\*Expected Result:?\*\*/i.test(trimmed)) {
      expected = trimmed.replace(/^\*\*Expected Result:?\*\*/i, "").trim();
    }
  });
  return { steps, expected };
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildStepsXml(steps, expected) {
  const list = (steps || []).filter(Boolean);
  if (!list.length) return "";
  let xml = `<steps id="0" last="${list.length}">`;
  list.forEach((action, index) => {
    const isLast = index === list.length - 1;
    const expectedText = isLast ? (expected || "") : "";
    xml += `<step id="${index + 1}" type="ActionStep">` +
      `<parameterizedString isformatted="true">${escapeXml(action)}</parameterizedString>` +
      `<parameterizedString isformatted="true">${escapeXml(expectedText)}</parameterizedString>` +
      "<description/></step>";
  });
  xml += "</steps>";
  return xml;
}

// Constrói a árvore genérica { type:'root', children:[...] } a partir das
// linhas do CSV.
export function buildTreeFromCsvRows(objects) {
  const root = { type: "root", children: [] };
  const levelNodes = [];

  objects.forEach((row) => {
    const type = (row["Work Item Type"] || "").trim();
    if (!type) return;

    const titleCols = Object.keys(row)
      .filter((k) => /^Title\s*\d+$/i.test(k))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

    let depth = -1;
    let title = "";
    for (let i = 0; i < titleCols.length; i++) {
      const value = (row[titleCols[i]] || "").trim();
      if (value) { depth = i; title = value; break; }
    }
    if (depth === -1) return;

    const description = row["Description"] || "";
    const nodeOpts = {
      areaPath: (row["Area Path"] || "").trim(),
      iterationPath: (row["Iteration Path"] || "").trim(),
      tags: row["Tags"] || "",
      description,
      countryValue: (row["Country"] || "").trim()
    };
    if (type === "Test Case") {
      const parsed = extractStepsFromDescription(description);
      if (parsed.steps.length) nodeOpts.stepsXml = buildStepsXml(parsed.steps, parsed.expected);
    }

    const node = { type, title, children: [], opts: nodeOpts };
    const parent = depth === 0 ? root : (levelNodes[depth - 1] || root);
    parent.children.push(node);
    levelNodes[depth] = node;
    levelNodes.length = depth + 1;
  });

  return root;
}

// Constrói a mesma árvore genérica a partir de uma lista plana de itens
// cadastrados manualmente (aba Manual), cada um com parentId apontando para
// outro item da lista ou null/undefined para virar raiz.
export function buildTreeFromManualItems(items) {
  const root = { type: "root", children: [] };
  const nodeById = new Map();
  items.forEach((item) => {
    const node = {
      type: item.type,
      title: item.title,
      children: [],
      opts: {
        areaPath: item.areaPath || "",
        iterationPath: item.iterationPath || "",
        tags: item.tags || "",
        description: item.description || "",
        countryValue: item.countryValue || ""
      }
    };
    if (item.type === "Test Case" && item.description) {
      const parsed = extractStepsFromDescription(item.description);
      if (parsed.steps.length) node.opts.stepsXml = buildStepsXml(parsed.steps, parsed.expected);
    }
    nodeById.set(item.id, node);
  });
  items.forEach((item) => {
    const node = nodeById.get(item.id);
    const parent = item.parentId ? nodeById.get(item.parentId) : null;
    (parent || root).children.push(node);
  });
  return root;
}

// Primeiro node com Area Path/Iteration Path preenchidos (tipicamente o
// Epic), usado para pré-preencher os campos de fallback a partir do CSV.
export function findFirstConfigSource(root) {
  let found = null;
  (function walk(node) {
    if (found) return;
    if (node.type !== "root" && node.opts && (node.opts.areaPath || node.opts.iterationPath)) { found = node; return; }
    (node.children || []).forEach(walk);
  })(root);
  return found;
}

export function countNodes(root) {
  const counts = {};
  (function walk(node) {
    if (node.type !== "root") counts[node.type] = (counts[node.type] || 0) + 1;
    (node.children || []).forEach(walk);
  })(root);
  return counts;
}
