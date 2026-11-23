"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeUpdateSettings } = require("./update-core");

function resolveDataRoot() {
  const baseRoot = process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd();
  return path.join(baseRoot, "DV-EXPORT", "updates");
}

function createUpdatePaths() {
  const root = resolveDataRoot();
  return {
    root,
    downloads: path.join(root, "downloads"),
    sessions: path.join(root, "sessions"),
    logs: path.join(root, "logs"),
    stateFile: path.join(root, "state.json")
  };
}

function createDefaultState() {
  return {
    schemaVersion: 1,
    settings: normalizeUpdateSettings(null),
    pending: null,
    deferredVersion: "",
    lastResult: null
  };
}

function readState() {
  const paths = createUpdatePaths();
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.stateFile, "utf-8"));
    return {
      schemaVersion: 1,
      settings: normalizeUpdateSettings(parsed.settings),
      pending: parsed.pending && typeof parsed.pending === "object" ? parsed.pending : null,
      deferredVersion: String(parsed.deferredVersion || ""),
      lastResult: parsed.lastResult && typeof parsed.lastResult === "object" ? parsed.lastResult : null
    };
  } catch {
    return createDefaultState();
  }
}

function writeState(nextState) {
  const paths = createUpdatePaths();
  fs.mkdirSync(paths.root, { recursive: true });
  const normalized = {
    schemaVersion: 1,
    settings: normalizeUpdateSettings(nextState.settings),
    pending: nextState.pending || null,
    deferredVersion: String(nextState.deferredVersion || ""),
    lastResult: nextState.lastResult || null
  };
  const temporaryPath = `${paths.stateFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  fs.renameSync(temporaryPath, paths.stateFile);
  return normalized;
}

function updateState(mutator) {
  const current = readState();
  const next = mutator({ ...current }) || current;
  return writeState(next);
}

module.exports = {
  createDefaultState,
  createUpdatePaths,
  readState,
  updateState,
  writeState
};
