/**
 * sync:disable スクリプト
 *
 * enable で行った変更を全て元に戻し、同期を無効化する:
 *   1. 定期 pull のバックグラウンドタスクを解除
 *   2. シンボリックリンクを削除
 *   3. original-settings/ からバックアップした settings.json を復元
 *
 * enable -> disable の実行で環境が完全に元通りになることを保証する。
 */

import { execSync } from "child_process";
import { existsSync, lstatSync, unlinkSync, copyFileSync, rmSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { getSettingsPath, getBackupDir, getBackupPath } from "./utils.mjs";

// enable.mjs と同じ識別子を使用する
const PLIST_LABEL = "com.cursor-settings-sync";
const TASK_NAME = "CursorSettingsSync";

// ---------------------------------------------------------------------------
// 1. 定期 pull の無効化
// ---------------------------------------------------------------------------

/** OS に応じた定期実行タスクを解除する */
export function disablePeriodicPull() {
  if (process.platform === "darwin") {
    disableLaunchAgent();
  } else if (process.platform === "win32") {
    disableScheduledTask();
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }
}

/** Mac: launchctl unload で LaunchAgent を解除し、plist ファイルを削除する */
export function disableLaunchAgent() {
  const plistPath = join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${PLIST_LABEL}.plist`
  );

  if (!existsSync(plistPath)) {
    console.log("LaunchAgent not found. Skipping.");
    return;
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
  } catch {
    // 既に unload 済みの場合は無視
  }
  unlinkSync(plistPath);
  console.log(`LaunchAgent removed: ${plistPath}`);
}

/** Windows: schtasks /delete でタスクスケジューラからタスクを削除する */
export function disableScheduledTask() {
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, {
      stdio: "ignore",
    });
    console.log(`Scheduled task removed: ${TASK_NAME}`);
  } catch {
    console.log("Scheduled task not found. Skipping.");
  }
}

// ---------------------------------------------------------------------------
// 2. シンボリックリンクの削除
// ---------------------------------------------------------------------------

/**
 * Cursor 設定ディレクトリのシンボリックリンクを削除する。
 * lstatSync を使うことで、リンク先が存在しない壊れたシンボリックリンクも検出できる。
 * (existsSync はリンク先を辿るため、壊れたリンクに対して false を返す)
 */
export function removeSymlink() {
  const settingsPath = getSettingsPath();

  let stat;
  try {
    stat = lstatSync(settingsPath);
  } catch {
    console.log("No settings.json found. Skipping.");
    return;
  }

  if (!stat.isSymbolicLink()) {
    console.log("settings.json is not a symlink. Skipping removal.");
    return;
  }

  unlinkSync(settingsPath);
  console.log(`Removed symlink: ${settingsPath}`);
}

// ---------------------------------------------------------------------------
// 3. 元の settings.json の復元
// ---------------------------------------------------------------------------

/**
 * original-settings/settings.json を Cursor の設定ディレクトリにコピーして復元する。
 * 復元後、バックアップディレクトリは不要なので削除する。
 */
export function restoreSettings() {
  const settingsPath = getSettingsPath();
  const backupDir = getBackupDir();
  const backupPath = getBackupPath();

  if (!existsSync(backupPath)) {
    console.error("Backup not found. Cannot restore original settings.json.");
    console.error(`Expected backup at: ${backupPath}`);
    return;
  }

  copyFileSync(backupPath, settingsPath);
  console.log(`Restored settings.json from ${backupPath}`);

  rmSync(backupDir, { recursive: true, force: true });
  console.log(`Removed backup directory: ${backupDir}`);
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

export function main() {
  try {
    console.log("=== Cursor Settings Sync: Disable ===\n");

    console.log("[1/3] Disabling periodic pull...");
    disablePeriodicPull();

    console.log("\n[2/3] Removing symlink...");
    removeSymlink();

    console.log("\n[3/3] Restoring original settings...");
    restoreSettings();

    console.log("\nSync disabled successfully!");
  } catch (error) {
    console.error("\nFailed to disable sync:", error.message);
    process.exit(1);
  }
}

const thisFilePath = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(thisFilePath);
if (isDirectRun) {
  main();
}
