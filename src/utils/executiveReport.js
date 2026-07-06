// Relatório executivo — versão texto (clipboard/Slack) e PDF (jsPDF), usados
// tanto na Governança (todos os colaboradores) quanto em Meus Itens
// (relatório pessoal). Substitui o gerador de PDF byte-a-byte do userscript
// legado por uma biblioteca de verdade, como sugerido no README.
export function buildExecutiveReportText({ title, period, totals, rows }) {
  const lines = [
    title,
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    period ? `Período: ${period}` : null,
    "",
    `Colaboradores: ${totals.developers} | Cards: ${totals.cards}`,
    `Horas: ${totals.hours}h / meta ${totals.goal}h | Faltando: ${totals.missing}h | Excedente: ${totals.extra}h`,
    ""
  ].filter((line) => line !== null);

  const below = rows.filter((r) => r.tone === "danger");
  const above = rows.filter((r) => r.tone === "warning");

  lines.push("Abaixo da meta:");
  lines.push(...(below.length ? below.map((r) => `• ${r.name}: ${r.hours}h / ${r.goal}h (faltam ${Math.max(r.goal - r.hours, 0)}h)`) : ["• Nenhum"]));
  lines.push("");
  lines.push("Acima da meta:");
  lines.push(...(above.length ? above.map((r) => `• ${r.name}: ${r.hours}h / ${r.goal}h (excedente ${Math.max(r.hours - r.goal, 0)}h)`) : ["• Nenhum"]));

  return lines.join("\n");
}

export async function copyExecutiveReportText(payload) {
  const text = buildExecutiveReportText(payload);
  await navigator.clipboard?.writeText(text);
  return text;
}

const COLORS = {
  header: [15, 42, 68],
  accent: [14, 116, 144],
  danger: [185, 73, 0],
  warning: [180, 140, 10],
  primary: [3, 105, 161],
  muted: [100, 116, 139],
  text: [31, 41, 55],
  border: [216, 224, 233],
  cardBg: [247, 249, 252]
};

function toneColor(tone) {
  if (tone === "danger") return COLORS.danger;
  if (tone === "warning") return COLORS.warning;
  return COLORS.primary;
}

// Gera e baixa um PDF executivo (título, KPIs, tabela por colaborador).
// jsPDF é carregado sob demanda (import dinâmico) para não inflar o bundle
// inicial com uma biblioteca que só é usada quando alguém clica "Baixar PDF".
export async function downloadExecutiveReportPdf({ title, period, totals, rows, filename }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = 0;

  doc.setFillColor(...COLORS.header);
  doc.rect(0, 0, pageWidth, 66, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, margin, 32);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(period || "", margin, 50);
  y = 90;

  const kpis = [
    ["Colaboradores", String(totals.developers)],
    ["Cards", String(totals.cards)],
    ["Horas registradas", `${totals.hours}h`],
    ["Meta total", `${totals.goal}h`],
    ["Horas pendentes", `${totals.missing}h`],
    ["Excedente", `+${totals.extra}h`]
  ];
  const gap = 8;
  const cardWidth = (pageWidth - margin * 2 - gap * (kpis.length - 1)) / kpis.length;
  kpis.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + gap);
    doc.setFillColor(...COLORS.cardBg);
    doc.setDrawColor(...COLORS.border);
    doc.roundedRect(x, y, cardWidth, 46, 4, 4, "FD");
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(7.5);
    doc.text(label, x + 8, y + 16);
    doc.setTextColor(...COLORS.header);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + 8, y + 34);
    doc.setFont("helvetica", "normal");
  });
  y += 66;

  doc.setFillColor(...COLORS.accent);
  doc.rect(margin, y, pageWidth - margin * 2, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Colaborador", margin + 8, y + 15);
  doc.text("Horas", margin + 260, y + 15);
  doc.text("Meta", margin + 340, y + 15);
  doc.text("Saldo", margin + 420, y + 15);
  doc.text("Status", margin + 500, y + 15);
  y += 22;

  doc.setFont("helvetica", "normal");
  rows.forEach((row, index) => {
    const rowHeight = 24;
    if (y + rowHeight > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 40;
    }
    if (index % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, pageWidth - margin * 2, rowHeight, "F");
    }
    const balance = row.hours - row.goal;
    doc.setTextColor(...COLORS.text);
    doc.setFontSize(9.5);
    doc.text(String(row.name), margin + 8, y + 16);
    doc.text(`${row.hours}h`, margin + 260, y + 16);
    doc.text(`${row.goal}h`, margin + 340, y + 16);
    doc.text(`${balance >= 0 ? "+" : ""}${balance}h`, margin + 420, y + 16);
    doc.setTextColor(...toneColor(row.tone));
    doc.setFont("helvetica", "bold");
    doc.text(row.label, margin + 500, y + 16);
    doc.setFont("helvetica", "normal");
    y += rowHeight;
  });

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} — Stark Hub`, margin, doc.internal.pageSize.getHeight() - 16);

  doc.save(filename || `relatorio-executivo-${new Date().toISOString().slice(0, 10)}.pdf`);
}
