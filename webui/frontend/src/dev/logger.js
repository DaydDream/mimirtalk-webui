/*
 * MimirTalk 开发日志与错误面板。
 * 该脚本在普通发布页面中保持关闭，只有开发入口、显式参数或本地标记才会记录。
 */
(function attachMimirTalkDevLogger(global) {
  "use strict";

  if (global.MimirTalkDevLogger) return;

  const VERSION = 1;
  const PREFERENCE_KEY = "mimirtalk.dev.logger.enabled";
  const STORAGE_KEY = "mimirtalk.dev.logger.events.v1";
  const EVENT_NAME = "mimirtalk:dev-log";
  const LEVELS = ["debug", "info", "warn", "error"];
  const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?key)/i;
  const state = {
    enabled: false,
    events: [],
    maxEvents: 500,
    sequence: 0,
    listeners: new Set(),
    errorCaptureInstalled: false,
    persistTimer: null,
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function nowMs() {
    if (global.performance && typeof global.performance.now === "function") {
      return global.performance.now();
    }
    return Date.now();
  }

  function truncate(value, maxLength = 320) {
    const text = String(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}... [${text.length} chars]`;
  }

  function safeStorageGet(key) {
    try {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, value);
    } catch {
      // 隐私模式或禁用存储时，日志仍只在内存中可用。
    }
  }

  function safeStorageRemove(key) {
    try {
      if (global.localStorage) global.localStorage.removeItem(key);
    } catch {
      // 忽略存储不可用。
    }
  }

  function readPreference() {
    return safeStorageGet(PREFERENCE_KEY);
  }

  function searchParam(name) {
    try {
      const params = new URLSearchParams(global.location && global.location.search ? global.location.search : "");
      return params.get(name);
    } catch {
      return null;
    }
  }

  function detectEnabled() {
    const explicit = searchParam("devlog");
    if (explicit === "1" || explicit === "true") return true;
    if (explicit === "0" || explicit === "false") return false;
    const path = global.location && global.location.pathname ? global.location.pathname : "";
    if (/\/dev\/[^/]*\.html$/i.test(path)) return true;
    if (readPreference() === "1") return true;
    if (readPreference() === "0") return false;
    const host = global.location && global.location.hostname ? global.location.hostname.toLowerCase() : "";
    const userAgent = global.navigator && global.navigator.userAgent ? global.navigator.userAgent : "";
    const androidWebView = /\bAndroid\b/i.test(userAgent) && /\bwv\b/i.test(userAgent);
    if (androidWebView) return false;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  }

  function redactString(value, key = "") {
    if (SENSITIVE_KEY.test(key)) return "[redacted]";
    return truncate(value);
  }

  function redactValue(value, key = "", depth = 0) {
    if (SENSITIVE_KEY.test(key)) return "[redacted]";
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value, key);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value instanceof Error) return normalizeError(value);
    if (depth >= 4) return "[max-depth]";
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return {
        type: "Blob",
        size: value.size,
        mime_type: value.type || "",
      };
    }
    if (typeof File !== "undefined" && value instanceof File) {
      return {
        type: "File",
        name: value.name,
        size: value.size,
        mime_type: value.type || "",
      };
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
      return { type: "ArrayBuffer", byte_length: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
      return { type: value.constructor.name, byte_length: value.byteLength };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const items = value.slice(0, 25).map((item, index) => redactValue(item, `${key}[${index}]`, depth + 1));
      if (value.length > items.length) items.push(`[${value.length - items.length} more items]`);
      return items;
    }
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = redactValue(childValue, childKey, depth + 1);
    }
    return output;
  }

  function normalizeError(error) {
    if (!error) return null;
    if (error instanceof Error) {
      return {
        name: error.name || "Error",
        message: truncate(error.message || String(error)),
        code: error.code || null,
        status: error.status || null,
        stack: error.stack ? truncate(error.stack, 2400) : "",
      };
    }
    if (typeof error === "object") return redactValue(error);
    return { name: "Error", message: truncate(error) };
  }

  function summarizeEvent(entry) {
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      duration_ms: entry.duration_ms,
    };
  }

  function notify(entry, type) {
    if (type) {
      for (const listener of Array.from(state.listeners)) {
        try {
          listener({ type, entry });
        } catch {
          // 单个监听器失败不能影响日志写入。
        }
      }
      if (typeof global.CustomEvent === "function" && typeof global.dispatchEvent === "function") {
        global.dispatchEvent(new global.CustomEvent(EVENT_NAME, { detail: { type, entry } }));
      }
      return;
    }
    for (const listener of Array.from(state.listeners)) {
      try {
        listener({ type: "append", entry });
      } catch {
        // 忽略监听器错误。
      }
    }
    if (typeof global.CustomEvent === "function" && typeof global.dispatchEvent === "function") {
      global.dispatchEvent(new global.CustomEvent(EVENT_NAME, { detail: { type: "append", entry } }));
    }
  }

  function persistNow() {
    if (state.persistTimer) {
      clearTimeout(state.persistTimer);
      state.persistTimer = null;
    }
    const payload = {
      schema_version: VERSION,
      saved_at: nowIso(),
      sequence: state.sequence,
      events: state.events.slice(-state.maxEvents),
    };
    safeStorageSet(STORAGE_KEY, JSON.stringify(payload));
  }

  function schedulePersist() {
    if (state.persistTimer) return;
    state.persistTimer = setTimeout(() => {
      state.persistTimer = null;
      persistNow();
    }, 120);
  }

  function loadPersisted() {
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.events)) return;
      state.events = payload.events.slice(-state.maxEvents);
      state.sequence = Number(payload.sequence) || state.events.length;
    } catch {
      safeStorageRemove(STORAGE_KEY);
    }
  }

  function mirrorConsole(entry) {
    if (!global.console) return;
    const method = typeof global.console[entry.level] === "function" ? entry.level : "log";
    try {
      global.console[method](`[${entry.scope}] ${entry.message}`, entry.error || entry.data || "");
    } catch {
      // 控制台不可用时忽略。
    }
  }

  function writeEvent(level, scope, message, data, error, durationMs) {
    if (!state.enabled) return null;
    const entry = {
      id: `log_${Date.now().toString(36)}_${state.sequence.toString(36)}`,
      sequence: state.sequence,
      timestamp: nowIso(),
      level: LEVELS.includes(level) ? level : "info",
      scope: String(scope || "app"),
      message: truncate(message || ""),
      data: data === undefined ? null : redactValue(data),
      error: normalizeError(error),
      duration_ms: typeof durationMs === "number" ? Math.round(durationMs) : null,
      page: {
        url: global.location && global.location.href ? global.location.href : "",
        path: global.location && global.location.pathname ? global.location.pathname : "",
      },
    };
    state.sequence += 1;
    state.events.push(entry);
    if (state.events.length > state.maxEvents) {
      state.events.splice(0, state.events.length - state.maxEvents);
    }
    schedulePersist();
    notify(entry);
    mirrorConsole(entry);
    return entry;
  }

  function getEvents(options = {}) {
    let events = state.events.slice();
    if (options.level && options.level !== "all") {
      events = events.filter((entry) => entry.level === options.level);
    }
    if (options.scope) {
      const scope = String(options.scope).toLowerCase();
      events = events.filter((entry) => entry.scope.toLowerCase().includes(scope));
    }
    if (options.query) {
      const query = String(options.query).toLowerCase();
      events = events.filter((entry) => {
        const text = [
          entry.message,
          entry.scope,
          JSON.stringify(entry.data || {}),
          JSON.stringify(entry.error || {}),
        ].join(" ").toLowerCase();
        return text.includes(query);
      });
    }
    if (options.limit && options.limit > 0) {
      events = events.slice(-options.limit);
    }
    return events;
  }

  function getSummary() {
    const summary = { total: state.events.length, debug: 0, info: 0, warn: 0, error: 0, last_at: null };
    for (const entry of state.events) {
      summary[entry.level] = (summary[entry.level] || 0) + 1;
      summary.last_at = entry.timestamp;
    }
    return summary;
  }

  function exportSnapshot() {
    return {
      schema_version: VERSION,
      exported_at: nowIso(),
      enabled: state.enabled,
      page: {
        url: global.location && global.location.href ? global.location.href : "",
        user_agent: global.navigator && global.navigator.userAgent ? global.navigator.userAgent : "",
      },
      summary: getSummary(),
      events: state.events.slice(),
    };
  }

  function record(level, scope, message, data, error, durationMs) {
    return writeEvent(level, scope, message, data, error, durationMs);
  }

  function recordError(scope, message, error, data) {
    return writeEvent("error", scope, message, data, error);
  }

  function wrap(scope, fn, options = {}) {
    if (typeof fn !== "function") return fn;
    const label = options.label || fn.name || "anonymous";
    return function wrappedDevLoggerFunction(...args) {
      const started = nowMs();
      let result;
      try {
        result = fn.apply(this, args);
      } catch (error) {
        writeEvent("error", scope, `${label} failed`, { args: options.includeArgs === false ? null : args }, error, nowMs() - started);
        throw error;
      }
      if (result && typeof result.then === "function") {
        return result.then(
          (value) => {
            writeEvent(options.level || "debug", scope, `${label} ok`, {
              args: options.includeArgs === false ? null : args,
              result: options.includeResult === false ? null : value,
            }, null, nowMs() - started);
            return value;
          },
          (error) => {
            writeEvent("error", scope, `${label} failed`, {
              args: options.includeArgs === false ? null : args,
            }, error, nowMs() - started);
            throw error;
          },
        );
      }
      writeEvent(options.level || "debug", scope, `${label} ok`, {
        args: options.includeArgs === false ? null : args,
        result: options.includeResult === false ? null : result,
      }, null, nowMs() - started);
      return result;
    };
  }

  function wrapMethods(target, scope, methods, options = {}) {
    for (const method of methods || []) {
      if (!target || typeof target[method] !== "function") continue;
      target[method] = wrap(`${scope}.${method}`, target[method].bind(target), options);
    }
    return target;
  }

  function installErrorCapture() {
    if (state.errorCaptureInstalled || typeof global.addEventListener !== "function") return;
    state.errorCaptureInstalled = true;
    global.addEventListener("error", (event) => {
      if (event && event.error) {
        recordError("window.error", event.message || "Unhandled error", event.error, {
          source: event.filename || "",
          line: event.lineno || null,
          column: event.colno || null,
        });
      }
    });
    global.addEventListener("unhandledrejection", (event) => {
      recordError("window.rejection", "Unhandled promise rejection", event.reason);
    });
    global.addEventListener("pagehide", persistNow);
  }

  function enable() {
    state.enabled = true;
    safeStorageSet(PREFERENCE_KEY, "1");
    writeEvent("info", "logger", "开发日志已启用", { version: VERSION });
    return state.enabled;
  }

  function disable() {
    writeEvent("info", "logger", "开发日志即将关闭");
    state.enabled = false;
    safeStorageSet(PREFERENCE_KEY, "0");
    persistNow();
    return state.enabled;
  }

  function clear() {
    state.events = [];
    state.sequence = 0;
    safeStorageRemove(STORAGE_KEY);
    notify(null, "clear");
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  function selfTest() {
    const wasEnabled = state.enabled;
    if (!wasEnabled) state.enabled = true;
    const started = nowMs();
    writeEvent("info", "logger.self-test", "日志面板自检", { secret: "should-redact" });
    const wrapped = wrap("logger.self-test.wrapped", (value) => value + 1, { label: "increment" });
    wrapped(41);
    try {
      throw Object.assign(new Error("自检错误"), { code: "DEV_SELF_TEST" });
    } catch (error) {
      recordError("logger.self-test.error", "预期错误捕获", error);
    }
    const snapshot = exportSnapshot();
    if (!wasEnabled) state.enabled = false;
    return {
      passed: snapshot.events.some((entry) => entry.error && entry.error.code === "DEV_SELF_TEST")
        && snapshot.events.some((entry) => entry.duration_ms !== null)
        && snapshot.events.some((entry) => entry.data && entry.data.secret === "[redacted]"),
      elapsed_ms: Math.round(nowMs() - started),
      snapshot,
    };
  }

  global.MimirTalkDevLogger = {
    version: VERSION,
    isEnabled: () => state.enabled,
    enable,
    disable,
    clear,
    subscribe,
    getEvents,
    getSummary,
    exportSnapshot,
    record,
    debug: (scope, message, data) => record("debug", scope, message, data),
    info: (scope, message, data) => record("info", scope, message, data),
    warn: (scope, message, data) => record("warn", scope, message, data),
    error: (scope, message, error, data) => recordError(scope, message, error, data),
    recordError,
    wrap,
    wrapMethods,
    installErrorCapture,
    selfTest,
    _internal: {
      detectEnabled,
      redactValue,
      summarizeEvent,
    },
  };

  state.enabled = detectEnabled();
  loadPersisted();
  installErrorCapture();
  if (state.enabled) writeEvent("info", "logger", "开发日志会话已启动", { version: VERSION });
})(typeof window !== "undefined" ? window : globalThis);
