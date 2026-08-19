import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import { usePersistentState } from "./usePersistentState.js";
import {
  hcAppendHistoryBlock,
  hcBlocksForRange,
  hcBlocksFromLiveRows,
  hcBuildDailyHistory,
  hcBuildInitialHistory,
  hcCalculateSystemStatus,
  hcDateRangeForPreset,
  hcDeriveActiveIncidents,
  hcDetectResolvedIncidents,
  hcDownsampleBlocks,
  hcIncidentStartedAt,
  hcLiveBlocksForRange,
  hcLoadHealthcheckResult,
  hcNormalizeLiveResult,
  hcReadLastResult,
  hcRefreshIntervalSeconds,
  hcSaveLastResult,
  hcSeedCountries,
  hcStorageKeys,
  hcUptimeForBlocks
} from "../utils/workbench/healthcheck.js";

function newCountryId(code) {
  return `${String(code || "xx").toLowerCase()}-${Date.now().toString(36)}`;
}

// Quantas execucoes reais buscar do Supabase por refresh — a cada 5min, 3000
// linhas cobrem ~10 dias. Cobre o KPI de 7 dias com folga; 30d/90d ficam
// parciais ate a pipeline acumular mais historico (sem inventar o resto).
const LIVE_ROWS_LIMIT = 3000;

async function fetchLiveRows(environment) {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("healthcheck_results")
    .select("*")
    .eq("environment", environment)
    .order("createdAt", { ascending: false })
    .limit(LIVE_ROWS_LIMIT);
  if (error || !data) return [];
  return data;
}

export function useHealthcheck() {
  const [countries, setCountries] = usePersistentState(hcStorageKeys.countries, hcSeedCountries);
  const [environment, setEnvironment] = usePersistentState(hcStorageKeys.environment, "PROD");
  const [scenario, setScenario] = usePersistentState(hcStorageKeys.scenario, "operational");
  const [autoRefresh, setAutoRefresh] = usePersistentState(hcStorageKeys.autoRefresh, true);
  const [history, setHistory] = usePersistentState(hcStorageKeys.history, null);
  const [dailyHistory, setDailyHistory] = usePersistentState(hcStorageKeys.dailyHistory, null);
  const [periodPreset, setPeriodPreset] = usePersistentState(hcStorageKeys.periodPreset, "24h");
  const initialRange = hcDateRangeForPreset("24h");
  const [periodFrom, setPeriodFrom] = usePersistentState(hcStorageKeys.periodFrom, initialRange.from);
  const [periodTo, setPeriodTo] = usePersistentState(hcStorageKeys.periodTo, initialRange.to);
  const [incidentLog, setIncidentLog] = usePersistentState(hcStorageKeys.incidentLog, []);
  const [result, setResult] = useState(() => hcReadLastResult()?.result || null);
  const [liveBlocks, setLiveBlocks] = useState([]); // [] enquanto a pipeline real nao publicou nada ainda
  const [loading, setLoading] = useState(true);
  // Timestamp alvo do proximo refresh, nao um contador de segundos em
  // estado do React — um segundo por segundo aqui forcaria a pagina INTEIRA
  // (graficos Recharts inclusive) a re-renderizar a cada tick, reanimando as
  // barras do zero sem parar (o "piscar" reportado pelo usuario). O
  // countdown visual e derivado disso localmente, isolado num componente
  // proprio (ver AutoRefreshCountdown no Workbench).
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now() + hcRefreshIntervalSeconds * 1000);
  const resultRef = useRef(result);
  resultRef.current = result;

  const hasLiveData = liveBlocks.length > 0;

  const activeCountryKey = useMemo(
    () => countries.filter((country) => country.active).map((country) => country.code).join(","),
    [countries]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const rows = await fetchLiveRows(environment);
    let next;
    let nextLiveBlocks = [];
    if (rows.length) {
      nextLiveBlocks = hcBlocksFromLiveRows(rows);
      next = hcNormalizeLiveResult(rows[0], countries); // rows[0] = mais recente (order desc)
    } else {
      next = await hcLoadHealthcheckResult(countries, environment, scenario);
    }
    const resolved = hcDetectResolvedIncidents(resultRef.current, next, countries);
    if (resolved.length) setIncidentLog((current) => [...resolved, ...current].slice(0, 20));
    setResult(next);
    setLiveBlocks(nextLiveBlocks);
    hcSaveLastResult(next);
    if (!nextLiveBlocks.length) setHistory((current) => hcAppendHistoryBlock(current || [], next));
    setNextRefreshAt(Date.now() + hcRefreshIntervalSeconds * 1000);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries, environment, scenario, setHistory, setIncidentLog]);

  // Seed inicial do historico fino demo (24h) e do backdrop diario demo (90
  // dias) na primeira vez que o modulo roda neste navegador — so usado
  // enquanto a pipeline real nao publicou nada ainda (ver hasLiveData).
  useEffect(() => {
    if (!history || !history.length) setHistory(hcBuildInitialHistory(countries, scenario, environment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDailyHistory(hcBuildDailyHistory(countries, environment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, activeCountryKey]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, scenario, activeCountryKey]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(refresh, hcRefreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  function applyPeriodPreset(preset) {
    setPeriodPreset(preset);
    if (preset === "custom") return;
    const range = hcDateRangeForPreset(preset);
    setPeriodFrom(range.from);
    setPeriodTo(range.to);
  }

  function setCustomPeriod(from, to) {
    setPeriodPreset("custom");
    if (from) setPeriodFrom(from);
    if (to) setPeriodTo(to);
  }

  function addCountry(data) {
    const now = new Date().toISOString();
    const code = String(data.code || "").toUpperCase().trim();
    const entry = {
      id: newCountryId(code),
      code,
      name: String(data.name || "").trim(),
      iso2: String(data.iso2 || code).toLowerCase().trim(),
      webUrl: String(data.webUrl || "").trim(),
      bffUrl: String(data.bffUrl || "").trim(),
      partner: String(data.partner || "").trim(),
      active: data.active !== false,
      maintenance: false,
      createdAt: now,
      updatedAt: now
    };
    setCountries((current) => [...current, entry]);
    return entry;
  }

  function updateCountry(id, patch) {
    setCountries((current) => current.map((country) => (country.id === id ? { ...country, ...patch, updatedAt: new Date().toISOString() } : country)));
  }

  function removeCountry(id) {
    setCountries((current) => current.filter((country) => country.id !== id));
  }

  function toggleCountryActive(id) {
    setCountries((current) => current.map((country) => (country.id === id ? { ...country, active: !country.active, updatedAt: new Date().toISOString() } : country)));
  }

  function toggleCountryMaintenance(id) {
    setCountries((current) => current.map((country) => (country.id === id ? { ...country, maintenance: !country.maintenance, updatedAt: new Date().toISOString() } : country)));
  }

  const systemStatus = useMemo(() => {
    if (!result) return "unknown";
    return hcCalculateSystemStatus(result.countries.map((row) => row.status));
  }, [result]);

  const activeIncidents = useMemo(() => {
    if (!result) return [];
    const historyForIncidents = hasLiveData ? liveBlocks : (history || []);
    return hcDeriveActiveIncidents(result, countries).map((incident) => ({
      ...incident,
      startedAt: hcIncidentStartedAt(historyForIncidents, incident.countryCode)
    }));
  }, [result, countries, history, liveBlocks, hasLiveData]);

  // Blocos completos (sem downsample) de um intervalo — precisao total pro
  // NUMERO de uptime. hasLiveData usa as execucoes reais direto; senao cai
  // no hibrido fino(24h)+diario(90d) do motor de demo.
  function blocksForRange(fromDate, toDate, countryCode) {
    return hasLiveData
      ? hcLiveBlocksForRange(liveBlocks, fromDate, toDate, countryCode)
      : hcBlocksForRange(history || [], dailyHistory || [], fromDate, toDate, countryCode);
  }

  // KPIs fixos (brief #17) — sempre 24h/7d/30d/90d reais, independente do
  // filtro de periodo ajustavel abaixo (que alimenta os graficos/heatmaps
  // por pais).
  const uptime = useMemo(() => {
    const ranges = { h24: "24h", d7: "7d", d30: "30d", d90: "90d" };
    return Object.fromEntries(Object.entries(ranges).map(([key, preset]) => {
      const range = hcDateRangeForPreset(preset);
      return [key, hcUptimeForBlocks(blocksForRange(range.from, range.to))];
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveData, liveBlocks, history, dailyHistory]);

  // Blocos do periodo ATUALMENTE selecionado (preset ou custom), reduzidos
  // pra caber no heatmap visual — geral e por pais.
  const periodBlocksByCountry = useMemo(() => {
    const build = (code) => hcDownsampleBlocks(blocksForRange(periodFrom, periodTo, code));
    const map = { overall: build(undefined) };
    countries.forEach((country) => { map[country.code] = build(country.code); });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveData, liveBlocks, history, dailyHistory, countries, periodFrom, periodTo]);

  // Uptime do periodo selecionado — precisao total (nao usa a versao
  // reduzida acima, so o heatmap precisa dela).
  const periodUptimeByCountry = useMemo(() => {
    const map = { overall: hcUptimeForBlocks(blocksForRange(periodFrom, periodTo)) };
    countries.forEach((country) => { map[country.code] = hcUptimeForBlocks(blocksForRange(periodFrom, periodTo, country.code)); });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveData, liveBlocks, history, dailyHistory, countries, periodFrom, periodTo]);

  return {
    countries,
    addCountry,
    updateCountry,
    removeCountry,
    toggleCountryActive,
    toggleCountryMaintenance,
    environment,
    setEnvironment,
    scenario,
    setScenario,
    autoRefresh,
    setAutoRefresh,
    nextRefreshAt,
    result,
    hasLiveData,
    loading,
    refresh,
    history: history || [],
    dailyHistory: dailyHistory || [],
    periodPreset,
    periodFrom,
    periodTo,
    applyPeriodPreset,
    setCustomPeriod,
    periodBlocksByCountry,
    periodUptimeByCountry,
    incidentLog,
    activeIncidents,
    systemStatus,
    uptime
  };
}
