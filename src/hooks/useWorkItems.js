import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoWorkItems, updateDemoWorkItem, addDemoWorkItem } from "../utils/demoStore.js";

// Fonte de work items do painel. No modo demo, vem do localStorage (editável
// localmente). Fora do modo demo, ainda não há integração real com a API do
// Azure DevOps (próximo passo do roadmap — ver README) — por isso a lista
// vem vazia em vez de mostrar dados fictícios como se fossem reais.
export function useWorkItems() {
  const { demoMode } = useAuth();
  const [items, setItems] = useState(() => (demoMode ? getDemoWorkItems() : []));

  useEffect(() => {
    setItems(demoMode ? getDemoWorkItems() : []);
  }, [demoMode]);

  function updateItem(id, patch) {
    if (!demoMode) return;
    setItems(updateDemoWorkItem(id, patch));
  }

  function addItem(item) {
    if (!demoMode) return;
    setItems(addDemoWorkItem(item));
  }

  return { items, updateItem, addItem, needsAzureIntegration: !demoMode };
}
