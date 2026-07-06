// Persistência local do modo demonstração. Como não há Supabase por trás,
// as edições feitas nas telas de Governança/Colaboradores (feature flags,
// papéis, dados de colaborador) são gravadas no localStorage — assim o
// modo demo se comporta como uma conta real: o que você edita continua
// editado ao navegar entre telas ou recarregar a página.
import { mockCollaborators, mockFeatureFlags, mockWorkItems } from "./mockData.js";

const STORAGE_KEY = "starkHubDemoState";

function readState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage indisponível (modo privado, quota) — segue só em memória.
  }
}

function seedState() {
  const seeded = {
    collaborators: mockCollaborators,
    featureFlags: mockFeatureFlags,
    workItems: mockWorkItems
  };
  writeState(seeded);
  return seeded;
}

function getState() {
  return readState() || seedState();
}

export function resetDemoState() {
  writeState(null);
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function getDemoFeatureFlags() {
  return getState().featureFlags;
}

export function setDemoFeatureFlag(key, value) {
  const state = getState();
  const next = { ...state, featureFlags: { ...state.featureFlags, [key]: value } };
  writeState(next);
  return next.featureFlags;
}

export function getDemoCollaborators() {
  return getState().collaborators;
}

export function updateDemoCollaborator(id, patch) {
  const state = getState();
  const collaborators = state.collaborators.map((person) => (person.id === id ? { ...person, ...patch } : person));
  const next = { ...state, collaborators };
  writeState(next);
  return collaborators;
}

export function deleteDemoCollaborator(id) {
  const state = getState();
  const collaborators = state.collaborators.filter((person) => person.id !== id);
  writeState({ ...state, collaborators });
  return collaborators;
}

export function addDemoCollaborator(patch) {
  const state = getState();
  const created = {
    id: `c${Date.now()}`, profileId: null, azureName: "", slackName: "", slackMemberId: "",
    aliases: [], color: "#475569", imageUrl: "", isQa: false, isDev: true, isManagement: false,
    ...patch
  };
  const collaborators = [...state.collaborators, created];
  writeState({ ...state, collaborators });
  return { collaborators, created };
}

export function getDemoWorkItems() {
  return getState().workItems;
}

export function updateDemoWorkItem(id, patch) {
  const state = getState();
  const workItems = state.workItems.map((item) => (item.id === id ? { ...item, ...patch } : item));
  const next = { ...state, workItems };
  writeState(next);
  return workItems;
}

export function addDemoWorkItem(item) {
  const state = getState();
  const nextId = Math.max(0, ...state.workItems.map((i) => i.id)) + 1;
  const created = { id: nextId, updatedAt: new Date().toISOString(), ...item };
  const workItems = [created, ...state.workItems];
  writeState({ ...state, workItems });
  return workItems;
}
