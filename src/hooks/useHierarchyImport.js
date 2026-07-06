import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export function useHierarchyImport() {
  const { profile } = useAuth();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  async function runImport(tree, defaults) {
    setImporting(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("azureHierarchyImport", {
      body: {
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        pat: profile.azurePat,
        tree,
        defaults
      }
    });
    setImporting(false);
    if (error || !data?.ok) {
      setResult({ ok: false, error: error?.message || data?.error || "Falha desconhecida." });
      return { ok: false };
    }
    setResult({ ok: true, counts: data.counts, log: data.log });
    return { ok: true };
  }

  return { runImport, importing, result };
}
