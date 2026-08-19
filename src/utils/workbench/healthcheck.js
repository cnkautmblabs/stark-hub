// =============================================================================
// CONFIG
// =============================================================================
// Monitor sintetico dos BFFs/Web da Cinemark LATAM. A pipeline real (Azure
// DevOps, repo qa-playwright-mblabs, azure-pipelines-healthchecks.yml, roda
// a cada 5min) publica cada execucao na tabela Supabase public.healthcheck_
// results via a Edge Function healthcheckIngest. O hook prefere sempre esse
// dado real; só cai para o gerador de demo/mock abaixo enquanto a tabela
// estiver vazia (antes da pipeline ser conectada, ou localmente sem Supabase
// configurado).
export const hcStorageKeys = {
  countries: "stark-healthcheck-countries",
  environment: "stark-healthcheck-environment",
  scenario: "stark-healthcheck-demo-scenario",
  autoRefresh: "stark-healthcheck-auto-refresh",
  history: "stark-healthcheck-history",
  dailyHistory: "stark-healthcheck-daily-history",
  periodPreset: "stark-healthcheck-period-preset",
  periodFrom: "stark-healthcheck-period-from",
  periodTo: "stark-healthcheck-period-to",
  incidentLog: "stark-healthcheck-incident-log",
  lastResult: "stark-healthcheck-last-result"
};

export const hcRefreshIntervalSeconds = 300; // pipeline roda */5 * * * *
export const hcHistoryBlockMinutes = 30;
export const hcHistoryBlockCount = 48; // 48 x 30min = ultimas 24h

export const hcEnvironments = ["PROD", "BETA", "QA", "DEV"];

export const hcStatusOrder = ["operational", "degraded", "outage", "maintenance", "unknown"];

export const hcStatusStyle = {
  operational: { color: "var(--starkHcOperational)", background: "var(--starkHcOperationalBg)", icon: "bi-check-circle-fill" },
  degraded: { color: "var(--starkHcDegraded)", background: "var(--starkHcDegradedBg)", icon: "bi-exclamation-triangle-fill" },
  outage: { color: "var(--starkHcOutage)", background: "var(--starkHcOutageBg)", icon: "bi-x-octagon-fill" },
  maintenance: { color: "var(--starkHcMaintenance)", background: "var(--starkHcMaintenanceBg)", icon: "bi-cone-striped" },
  unknown: { color: "var(--starkHcUnknown)", background: "var(--starkHcUnknownBg)", icon: "bi-question-circle-fill" }
};

// Healthchecks reais executados pela pipeline por pais (brief #11).
export const hcEndpoints = [
  { key: "login", name: "Login Member", method: "POST", path: "/api/login-member" },
  { key: "getMember", name: "Get Member", method: "GET", path: "/api/get-member" },
  { key: "signOut", name: "Sign Out", method: "POST", path: "/api/auth/signout" }
];

export function hcSeedCountries() {
  const now = new Date().toISOString();
  return [
    { id: "ar", code: "AR", name: "Argentina", iso2: "ar", webUrl: "https://www.cinemark.com.ar", bffUrl: "https://bff.cinemark.com.ar", active: true, maintenance: false, createdAt: now, updatedAt: now },
    { id: "cl", code: "CL", name: "Chile", iso2: "cl", webUrl: "https://www.cinemark.cl", bffUrl: "https://bff.cinemark.cl", active: true, maintenance: false, createdAt: now, updatedAt: now },
    { id: "pe", code: "PE", name: "Peru", iso2: "pe", webUrl: "https://www.cinemark-peru.com", bffUrl: "https://bff.cinemark-peru.com", active: true, maintenance: false, createdAt: now, updatedAt: now },
    { id: "bo", code: "BO", name: "Bolivia", iso2: "bo", webUrl: "https://www.cinemark.com.bo", bffUrl: "https://bff.cinemark.com.bo", active: true, maintenance: false, createdAt: now, updatedAt: now },
    { id: "py", code: "PY", name: "Paraguay", iso2: "py", webUrl: "https://www.cinemark.com.py", bffUrl: "https://bff.cinemark.com.py", active: true, maintenance: false, createdAt: now, updatedAt: now }
  ];
}

// =============================================================================
// SEEDED RNG (historico/mocks reproduziveis por sessao, sem libs externas)
// =============================================================================
function hashSeed(text) {
  let hash = 1779033703 ^ String(text).length;
  for (let i = 0; i < String(text).length; i += 1) {
    hash = Math.imul(hash ^ String(text).charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = hashSeed(seed);
  next(); next(); next(); // descarta os primeiros valores (menos correlacionados em seeds curtas)
  return next;
}

// =============================================================================
// STATUS ENGINE — unica fonte de verdade pras regras de status (brief #26)
// =============================================================================
export function hcStatusFromSteps(steps = []) {
  if (!steps.length) return "unknown";
  const failed = steps.filter((step) => !step.ok);
  if (!failed.length) return "operational";
  const critical = failed.some((step) => step.httpStatus >= 500 || step.httpStatus === 0);
  return critical ? "outage" : "degraded";
}

export function hcCalculateCountryStatus(countryResult, countryConfig) {
  if (countryConfig?.maintenance) return "maintenance";
  if (countryConfig && !countryConfig.active) return "unknown";
  return hcStatusFromSteps(countryResult?.steps);
}

// Pior status "vence" — Outage > Degraded > Maintenance > Unknown > Operational.
const statusSeverity = { outage: 4, degraded: 3, maintenance: 2, unknown: 1, operational: 0 };

export function hcCalculateSystemStatus(countryStatuses = []) {
  const relevant = countryStatuses.filter((status) => status !== "maintenance" && status !== "unknown");
  if (!relevant.length) return "operational";
  return relevant.reduce((worst, status) => (statusSeverity[status] > statusSeverity[worst] ? status : worst), "operational");
}

// =============================================================================
// MOCK / DEMO ENGINE
// =============================================================================
// Cenarios de demonstracao (brief #13) — cada um define, por pais, se os
// healthchecks devem falhar e com que severidade.
export const hcScenarios = ["operational", "degraded", "outage"];

// Ambientes nao-PROD sao naturalmente mais instaveis na vida real (deploys
// mais frequentes, dados de teste) — sem isso, trocar o seletor de Ambiente
// nao mudava nada visivel e parecia quebrado (feedback do usuario: "garantir
// que mostra todos os ambientes certinho"). So empurra pra "degraded", nunca
// gera outage sozinho — outage continua exclusivo do cenario de demonstracao,
// pra nao conflitar os dois sinais.
export const hcEnvironmentNoise = { PROD: 0, BETA: 0.04, QA: 0.09, DEV: 0.16 };

function scenarioStepOutcome(rng, scenario, isFirstCountry) {
  if (scenario === "operational") return { ok: true, httpStatus: 200 };
  if (scenario === "degraded") {
    // Lentidao/erro pontual isolado, nao critico.
    if (isFirstCountry && rng() < 0.6) return { ok: false, httpStatus: 408 };
    return { ok: true, httpStatus: 200 };
  }
  // outage: pais afetado cai com erro 500 em todos os steps.
  if (isFirstCountry) return { ok: false, httpStatus: 500 };
  return { ok: true, httpStatus: 200 };
}

function stepOutcomeWithEnvironment(rng, scenario, isFirstCountry, environment) {
  const outcome = scenarioStepOutcome(rng, scenario, isFirstCountry);
  if (outcome.ok && rng() < (hcEnvironmentNoise[environment] ?? 0)) return { ok: false, httpStatus: 408 };
  return outcome;
}

function generateStep(endpoint, rng, scenario, isFirstCountry, environment) {
  const outcome = stepOutcomeWithEnvironment(rng, scenario, isFirstCountry, environment);
  const baseLatency = endpoint.method === "GET" ? 70 : 110;
  const jitter = Math.round(rng() * 160);
  return {
    key: endpoint.key,
    name: endpoint.name,
    endpoint: `${endpoint.method} ${endpoint.path}`,
    ok: outcome.ok,
    httpStatus: outcome.httpStatus,
    durationMs: outcome.ok ? baseLatency + jitter : baseLatency + jitter + 900,
    attempts: outcome.ok ? 1 : 1 + Math.floor(rng() * 2)
  };
}

export function hcGenerateDemoResult(countries, environment, scenario, seedSuffix = "") {
  const active = countries.filter((country) => country.active);
  const rng = makeRng(`${environment}:${scenario}:${active.map((c) => c.code).join(",")}:${seedSuffix}`);
  const startedAt = new Date();
  const countryResults = active.map((country, index) => {
    const steps = hcEndpoints.map((endpoint) => generateStep(endpoint, rng, scenario, index === 0, environment));
    const durationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
    return { country: country.code, countryId: country.id, status: hcCalculateCountryStatus({ steps }, country), durationMs, steps };
  });
  const finishedAt = new Date(startedAt.getTime() + countryResults.reduce((sum, row) => sum + row.durationMs, 0));
  return {
    source: "demo",
    environment,
    scenario,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    countries: countryResults,
    status: hcCalculateSystemStatus(countryResults.map((row) => row.status))
  };
}

// Ponto de integracao futuro: troca localStorage/mock por API/Supabase sem
// mexer na UI (brief #24/#51). Hoje tenta um JSON estatico opcional
// (publicado pela propria pipeline no futuro); se nao existir, cai no mock.
export async function hcLoadHealthcheckResult(countries, environment, scenario, seedSuffix = "") {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}healthcheck-result.json`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json();
      if (payload && Array.isArray(payload.countries)) return { ...payload, source: "live" };
    }
  } catch {
    // Sem pipeline publicando ainda — comportamento esperado, cai no mock abaixo.
  }
  return hcGenerateDemoResult(countries, environment, scenario, seedSuffix);
}

export function hcSaveLastResult(result) {
  try {
    window.localStorage.setItem(hcStorageKeys.lastResult, JSON.stringify({ result, savedAt: new Date().toISOString() }));
  } catch {
    // Quota/localStorage indisponivel: apenas nao persiste o fallback.
  }
}

export function hcReadLastResult() {
  try {
    const raw = window.localStorage.getItem(hcStorageKeys.lastResult);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// =============================================================================
// HISTORY ENGINE
// =============================================================================
function blockWeight(status) {
  if (status === "operational") return 1;
  if (status === "degraded") return 0.5;
  return 0; // outage
}

export function hcIsoDateLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export const hcPeriodPresets = ["24h", "7d", "30d", "90d", "custom"];
export const hcDailyHistoryDays = 90;

export function hcDateRangeForPreset(preset) {
  const end = new Date();
  const start = new Date(end);
  if (preset === "24h") return { from: hcIsoDateLocal(end), to: hcIsoDateLocal(end) };
  if (preset === "7d") { start.setDate(end.getDate() - 6); return { from: hcIsoDateLocal(start), to: hcIsoDateLocal(end) }; }
  if (preset === "30d") { start.setDate(end.getDate() - 29); return { from: hcIsoDateLocal(start), to: hcIsoDateLocal(end) }; }
  start.setDate(end.getDate() - (hcDailyHistoryDays - 1));
  return { from: hcIsoDateLocal(start), to: hcIsoDateLocal(end) };
}

export function hcBuildInitialHistory(countries, scenario, environment) {
  const active = countries.filter((country) => country.active);
  const now = Date.now();
  const stepMs = hcHistoryBlockMinutes * 60 * 1000;
  const blocks = [];
  for (let i = hcHistoryBlockCount - 1; i >= 0; i -= 1) {
    const at = new Date(now - i * stepMs).toISOString();
    const rng = makeRng(`hist:${scenario}:${environment}:${at}:${active.map((c) => c.code).join(",")}`);
    const byCountry = {};
    active.forEach((country, index) => {
      // Ultimo bloco (agora) sempre reflete o cenario atual com forca total;
      // blocos passados tem uma chance menor de ter tido o mesmo problema,
      // pra nao parecer um historico artificialmente uniforme (brief #40).
      const recencyBoost = i === 0 ? 1 : 0.35;
      const outcome = stepOutcomeWithEnvironment(rng, scenario, index === 0 && rng() < recencyBoostSafe(recencyBoost), environment);
      byCountry[country.code] = outcome.ok ? "operational" : (outcome.httpStatus >= 500 ? "outage" : "degraded");
    });
    const overall = hcCalculateSystemStatus(Object.values(byCountry));
    blocks.push({ at, overall, byCountry });
  }
  return blocks;
}

function recencyBoostSafe(value) {
  return Math.min(1, Math.max(0, value));
}

export function hcAppendHistoryBlock(history, result) {
  const byCountry = {};
  result.countries.forEach((row) => { byCountry[row.country] = row.status; });
  const nextBlock = { at: result.finishedAt || new Date().toISOString(), overall: result.status, byCountry };
  const next = [...(history || []), nextBlock];
  return next.slice(-hcHistoryBlockCount);
}

// Backdrop de dias ANTERIORES a hoje (brief #40) — deliberadamente NAO
// depende do cenario de demonstracao escolhido (esse reflete "agora", nao
// deveria reescrever o passado inteiro toda vez que alguem troca o seletor).
// So depende do ambiente (mais ruido em DEV/QA/BETA) e do conjunto de
// paises, entao fica estavel entre trocas de cenario.
export function hcBuildDailyHistory(countries, environment) {
  const active = countries.filter((country) => country.active);
  const today = new Date();
  const days = [];
  for (let i = hcDailyHistoryDays - 1; i >= 1; i -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = hcIsoDateLocal(date);
    const rng = makeRng(`daily:${environment}:${dateKey}:${active.map((c) => c.code).join(",")}`);
    const byCountry = {};
    active.forEach((country, index) => {
      const rareBlip = index === 0 && rng() < 0.06;
      const envNoise = rng() < (hcEnvironmentNoise[environment] ?? 0) * 0.5;
      byCountry[country.code] = (rareBlip || envNoise) ? (rng() < 0.5 ? "degraded" : "outage") : "operational";
    });
    days.push({ date: dateKey, overall: hcCalculateSystemStatus(Object.values(byCountry)), byCountry });
  }
  return days;
}

// Junta o backdrop diario (dias antes de hoje) com os blocos finos de hoje
// (`history`, resolucao de 30min) num unico conjunto de "blocos" pro
// intervalo [fromDate, toDate] — usado tanto pelo heatmap quanto pelo
// calculo de uptime, no geral ou por pais (countryCode omitido = geral).
export function hcBlocksForRange(history, dailyHistory, fromDate, toDate, countryCode) {
  const todayKey = hcIsoDateLocal(new Date());
  const blocks = [];
  (dailyHistory || []).forEach((day) => {
    if (day.date < fromDate || day.date > toDate || day.date === todayKey) return;
    const status = countryCode ? (day.byCountry[countryCode] || "unknown") : day.overall;
    blocks.push({ at: day.date, overall: status, granularity: "day" });
  });
  if (todayKey >= fromDate && todayKey <= toDate) {
    (history || []).forEach((block) => {
      const status = countryCode ? (block.byCountry[countryCode] || "unknown") : block.overall;
      blocks.push({ at: block.at, overall: status, granularity: "block" });
    });
  }
  return blocks;
}

export function hcUptimeForBlocks(blocks = []) {
  if (!blocks.length) return 100;
  const weights = blocks.map((block) => blockWeight(block.overall));
  return Math.round((weights.reduce((sum, value) => sum + value, 0) / weights.length) * 10000) / 100;
}

// =============================================================================
// LIVE DATA — normaliza linhas reais de public.healthcheck_results (gravadas
// pela Edge Function healthcheckIngest a partir da pipeline Azure DevOps)
// pro MESMO formato que o motor de demo produz, pra UI/status engine/
// incident engine nao precisarem saber a diferenca.
// =============================================================================
function hcStepKeyFromName(name) {
  const key = String(name || "").trim().toLowerCase();
  if (key === "login") return "login";
  if (key === "get member") return "getMember";
  if (key === "sign out") return "signOut";
  return key.replace(/\s+/g, "-") || "step";
}

export function hcNormalizeLiveResult(row, countries) {
  const byCode = new Map((countries || []).map((country) => [country.code, country]));
  const countryResults = (row.countries || []).map((entry) => {
    const config = byCode.get(entry.country);
    const steps = (entry.steps || []).map((step) => ({
      key: hcStepKeyFromName(step.name),
      name: step.name,
      endpoint: step.endpoint,
      ok: Boolean(step.ok),
      httpStatus: step.httpStatus ?? 0,
      durationMs: step.durationMs ?? 0,
      attempts: step.attempts ?? 1
    }));
    return {
      country: entry.country,
      countryId: config?.id || entry.country,
      status: hcCalculateCountryStatus({ steps }, config),
      durationMs: entry.durationMs ?? 0,
      steps
    };
  });
  return {
    source: "live",
    environment: row.environment,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt || row.startedAt,
    durationMs: row.durationMs ?? 0,
    countries: countryResults,
    status: hcCalculateSystemStatus(countryResults.map((entry) => entry.status))
  };
}

// Uma linha por execucao real (a cada 5min) -> um "bloco" {at, overall,
// byCountry}, mesmo formato dos blocos de historico do motor de demo.
// Ordenado cronologicamente (mais antigo primeiro).
export function hcBlocksFromLiveRows(rows = []) {
  return rows
    .slice()
    .sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")))
    .map((row) => {
      const byCountry = {};
      (row.countries || []).forEach((entry) => {
        const steps = (entry.steps || []).map((step) => ({ ok: Boolean(step.ok), httpStatus: step.httpStatus ?? 0 }));
        byCountry[entry.country] = hcStatusFromSteps(steps);
      });
      return { at: row.finishedAt || row.startedAt, overall: hcCalculateSystemStatus(Object.values(byCountry)), byCountry };
    });
}

// Recorta um array PLANO de blocos (ja em ordem cronologica) por data — sem
// a distincao dia/bloco fino do motor de demo, porque aqui SAO todas
// execucoes reais, uma granularidade so.
export function hcLiveBlocksForRange(blocks, fromDate, toDate, countryCode) {
  return (blocks || [])
    .filter((block) => {
      const dateKey = hcIsoDateLocal(block.at);
      return dateKey >= fromDate && dateKey <= toDate;
    })
    .map((block) => ({ at: block.at, overall: countryCode ? (block.byCountry?.[countryCode] || "unknown") : block.overall }));
}

// So pro HEATMAP visual: um periodo longo (ex. 90 dias a cada 5min) tem
// milhares de blocos, ilegivel como barra. O numero de uptime usa a lista
// cheia (hcLiveBlocksForRange) pra precisao; o heatmap usa esta versao
// reduzida. Cada bucket vira o PIOR status entre os blocos que caem nele
// (mesma filosofia "pior status vence" do resto do status engine).
export function hcDownsampleBlocks(blocks, targetCount = hcHistoryBlockCount) {
  if (blocks.length <= targetCount) return blocks;
  const bucketSize = Math.ceil(blocks.length / targetCount);
  const buckets = [];
  for (let i = 0; i < blocks.length; i += bucketSize) {
    const slice = blocks.slice(i, i + bucketSize);
    const worst = slice.reduce((acc, block) => (statusSeverity[block.overall] > statusSeverity[acc] ? block.overall : acc), slice[0].overall);
    buckets.push({ at: slice[slice.length - 1].at, overall: worst });
  }
  return buckets;
}

// =============================================================================
// INCIDENT ENGINE
// =============================================================================
export function hcDeriveActiveIncidents(result, countries) {
  if (!result) return [];
  const byId = new Map(countries.map((country) => [country.code, country]));
  return result.countries
    .filter((row) => row.status === "degraded" || row.status === "outage")
    .map((row) => {
      const failedStep = row.steps.find((step) => !step.ok);
      const config = byId.get(row.country);
      return {
        id: `${row.country}:${failedStep?.key || "unknown"}`,
        countryCode: row.country,
        countryName: config?.name || row.country,
        iso2: config?.iso2 || "",
        status: row.status,
        endpoint: failedStep?.endpoint || "-",
        httpStatus: failedStep?.httpStatus ?? 0,
        attempts: failedStep?.attempts ?? 1
      };
    });
}

export function hcIncidentStartedAt(history, countryCode) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const status = history[i].byCountry?.[countryCode];
    if (status === "operational" || status === undefined) {
      return i === history.length - 1 ? history[i].at : history[i + 1]?.at || history[i].at;
    }
  }
  return history[0]?.at || new Date().toISOString();
}

// Compara status "antes" x "depois" por pais e retorna incidentes recem
// resolvidos (transicao ruim -> operational), pra alimentar o log de
// "Recent Incidents" (brief #18). Chamado a cada refresh pelo hook.
export function hcDetectResolvedIncidents(previousResult, nextResult, countries) {
  if (!previousResult) return [];
  const byId = new Map(countries.map((country) => [country.code, country]));
  const previousByCountry = new Map(previousResult.countries.map((row) => [row.country, row.status]));
  return nextResult.countries
    .filter((row) => row.status === "operational")
    .filter((row) => {
      const before = previousByCountry.get(row.country);
      return before === "degraded" || before === "outage";
    })
    .map((row) => ({
      id: `${row.country}-${Date.now()}`,
      countryCode: row.country,
      countryName: byId.get(row.country)?.name || row.country,
      resolvedAt: nextResult.finishedAt || new Date().toISOString()
    }));
}
