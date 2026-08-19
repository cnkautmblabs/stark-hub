import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "./usePersistentState.js";
import {
  hcAppendHistoryBlock,
  hcBlocksForRange,
  hcBuildDailyHistory,
  hcBuildInitialHistory,
  hcCalculateSystemStatus,
  hcDateRangeForPreset,
  hcDeriveActiveIncidents,
  hcDetectResolvedIncidents,
  hcIncidentStartedAt,
  hcLoadHealthcheckResult,
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
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(hcRefreshIntervalSeconds);
  const resultRef = useRef(result);
  resultRef.current = result;

  const activeCountryKey = useMemo(
    () => countries.filter((country) => country.active).map((country) => country.code).join(","),
    [countries]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await hcLoadHealthcheckResult(countries, environment, scenario);
    const resolved = hcDetectResolvedIncidents(resultRef.current, next, countries);
    if (resolved.length) setIncidentLog((current) => [...resolved, ...current].slice(0, 20));
    setResult(next);
    hcSaveLastResult(next);
    setHistory((current) => hcAppendHistoryBlock(current || [], next));
    setCountdown(hcRefreshIntervalSeconds);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries, environment, scenario, setHistory, setIncidentLog]);

  // Seed inicial do historico fino (24h) e do backdrop diario (90 dias) na
  // primeira vez que o modulo roda neste navegador — depois disso o
  // historico fino so cresce por refresh real, e o diario e resemeado
  // apenas quando ambiente/paises mudam (ver efeito abaixo).
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
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          refresh();
          return hcRefreshIntervalSeconds;
        }
        return current - 1;
      });
    }, 1000);
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
    return hcDeriveActiveIncidents(result, countries).map((incident) => ({
      ...incident,
      startedAt: hcIncidentStartedAt(history || [], incident.countryCode)
    }));
  }, [result, countries, history]);

  // KPIs fixos (brief #17) — sempre 24h/7d/30d/90d reais, independente do
  // filtro de periodo ajustavel abaixo (que alimenta os graficos/heatmaps
  // por pais).
  const uptime = useMemo(() => {
    const ranges = { h24: "24h", d7: "7d", d30: "30d", d90: "90d" };
    return Object.fromEntries(Object.entries(ranges).map(([key, preset]) => {
      const range = hcDateRangeForPreset(preset);
      return [key, hcUptimeForBlocks(hcBlocksForRange(history || [], dailyHistory || [], range.from, range.to))];
    }));
  }, [history, dailyHistory]);

  // Blocos/uptime do periodo ATUALMENTE selecionado (preset ou custom),
  // geral e por pais — usado no heatmap por pais e no grafico de uptime.
  const periodBlocksByCountry = useMemo(() => {
    const map = { overall: hcBlocksForRange(history || [], dailyHistory || [], periodFrom, periodTo) };
    countries.forEach((country) => {
      map[country.code] = hcBlocksForRange(history || [], dailyHistory || [], periodFrom, periodTo, country.code);
    });
    return map;
  }, [history, dailyHistory, countries, periodFrom, periodTo]);

  const periodUptimeByCountry = useMemo(() => {
    return Object.fromEntries(Object.entries(periodBlocksByCountry).map(([key, blocks]) => [key, hcUptimeForBlocks(blocks)]));
  }, [periodBlocksByCountry]);

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
    countdown,
    result,
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
