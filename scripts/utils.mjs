/**
 * 共通ユーティリティ
 *
 * 各スクリプトで使用するパス解決やログ出力の共通関数を提供する。
 * OS ごとに Cursor の設定ディレクトリが異なるため、
 * process.platform で Mac / Windows を判定してパスを切り替える。
 */

import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { appendFileSync, mkdirSync, existsSync } from "fs";

// ESM では __dirname が使えないため、import.meta.url から算出する
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** このリポジトリのルートディレクトリ (scripts/ の1つ上) */
export const REPO_ROOT = join(__dirname, "..");

/**
 * Cursor がグローバル設定を保存しているディレクトリのパスを返す。
 *   Mac:     ~/Library/Application Support/Cursor/User
 *   Windows: %APPDATA%\Cursor\User
 */
export function getSettingsDir() {
  const platform = process.platform;
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Cursor", "User");
  }
  if (platform === "win32") {
    return join(process.env.APPDATA, "Cursor", "User");
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/** Cursor のグローバル settings.json のフルパスを返す */
export function getSettingsPath() {
  return join(getSettingsDir(), "settings.json");
}

/** 元の settings.json を退避するリポジトリ内ディレクトリのパスを返す */
export function getBackupDir() {
  return join(REPO_ROOT, "original-settings");
}

/** 退避した settings.json のフルパスを返す */
export function getBackupPath() {
  return join(getBackupDir(), "settings.json");
}

/** リポジトリで管理している共有用 settings.json のフルパスを返す */
export function getRepoSettingsPath() {
  return join(REPO_ROOT, "settings.json");
}

/** pull スクリプトの実行ログファイルのパスを返す */
export function getLogPath() {
  return join(REPO_ROOT, "logs", "pull.log");
}

function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * タイムスタンプ付きでログファイルに1行追記する。
 * logs/ ディレクトリが存在しなければ自動で作成する。
 *
 * 出力例: [2026-03-26 12:00:00] SUCCESS: Already up to date.
 */
export function log(message) {
  const logPath = getLogPath();
  const logDir = dirname(logPath);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const entry = `[${formatTimestamp()}] ${message}\n`;
  appendFileSync(logPath, entry, "utf-8");
}
