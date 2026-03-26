/**
 * sync:enable スクリプト
 *
 * 以下の 3 ステップで Cursor 設定の同期を有効化する:
 *   1. 現在の settings.json を original-settings/ にバックアップ
 *   2. リポジトリの settings.json へのシンボリックリンクを作成
 *   3. 定期的に git pull を実行するバックグラウンドタスクを登録
 *
 * 二重実行しても安全なように、既にシンボリックリンクが存在する場合はスキップする。
 */

import { execSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  REPO_ROOT,
  getSettingsPath,
  getBackupDir,
  getBackupPath,
  getRepoSettingsPath,
} from "./utils.mjs";

// Mac: launchd の LaunchAgent 識別子
const PLIST_LABEL = "com.cursor-settings-sync";
// Windows: タスクスケジューラのタスク名
const TASK_NAME = "CursorSettingsSync";

// ---------------------------------------------------------------------------
// 1. バックアップ
// ---------------------------------------------------------------------------

/**
 * Cursor のグローバル settings.json をリポジトリ内の original-settings/ に退避する。
 * 既にシンボリックリンクになっている場合は同期済みとみなしスキップする。
 * settings.json が存在しない環境では空の JSON ファイルをバックアップとして作成する。
 */
export function backupSettings() {
  const settingsPath = getSettingsPath();
  const backupDir = getBackupDir();
  const backupPath = getBackupPath();

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  if (existsSync(settingsPath)) {
    const stat = lstatSync(settingsPath);
    if (stat.isSymbolicLink()) {
      console.log("settings.json is already a symlink. Skipping backup.");
      return;
    }
    copyFileSync(settingsPath, backupPath);
    console.log(`Backed up settings.json to ${backupPath}`);
  } else {
    writeFileSync(backupPath, "{}\n", "utf-8");
    console.log("No existing settings.json found. Created empty backup.");
  }
}

// ---------------------------------------------------------------------------
// 2. シンボリックリンク作成
// ---------------------------------------------------------------------------

/**
 * Cursor の設定ディレクトリにリポジトリの settings.json へのシンボリックリンクを配置する。
 * これにより Cursor がリポジトリ側のファイルを直接参照するようになる。
 */
export function createSymlink() {
  const settingsPath = getSettingsPath();
  const repoSettingsPath = getRepoSettingsPath();

  if (existsSync(settingsPath)) {
    const stat = lstatSync(settingsPath);
    if (stat.isSymbolicLink()) {
      console.log("Symlink already exists. Skipping.");
      return;
    }
    // バックアップ済みの元ファイルを削除してシンボリックリンクに置き換える
    unlinkSync(settingsPath);
  }

  symlinkSync(repoSettingsPath, settingsPath);
  console.log(`Created symlink: ${settingsPath} -> ${repoSettingsPath}`);
}

// ---------------------------------------------------------------------------
// 3. 定期 pull のバックグラウンドタスク登録
// ---------------------------------------------------------------------------

/**
 * OS に応じた定期実行の仕組みを登録する。
 * どちらの OS でもログイン時に自動起動し、1時間ごとに pull を繰り返す。
 */
export function enablePeriodicPull() {
  const nodePath = process.execPath;
  const pullScript = join(REPO_ROOT, "scripts", "pull.mjs");

  if (process.platform === "darwin") {
    enableLaunchAgent(nodePath, pullScript);
  } else if (process.platform === "win32") {
    enableScheduledTask(nodePath, pullScript);
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }
}

/**
 * Mac: ~/Library/LaunchAgents/ に plist を作成し launchctl で登録する。
 * - RunAtLoad: ログイン時に即座に1回実行
 * - StartInterval: 以降 3600 秒 (1時間) ごとに繰り返し実行
 * - stdout/stderr は /dev/null に捨てる (ログは pull.mjs 側で logs/pull.log に記録)
 */
export function enableLaunchAgent(nodePath, pullScript) {
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(plistDir, `${PLIST_LABEL}.plist`);

  const plist = /* xml */ `
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>${PLIST_LABEL}</string>
        <key>ProgramArguments</key>
        <array>
          <string>${nodePath}</string>
          <string>${pullScript}</string>
        </array>
        <key>StartInterval</key>
        <integer>3600</integer>
        <key>RunAtLoad</key>
        <true/>
        <key>StandardOutPath</key>
        <string>/dev/null</string>
        <key>StandardErrorPath</key>
        <string>/dev/null</string>
      </dict>
    </plist>
  `;

  if (!existsSync(plistDir)) {
    mkdirSync(plistDir, { recursive: true });
  }
  writeFileSync(plistPath, plist, "utf-8");

  // 既に登録済みの場合は一度 unload してから再登録する
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, {
      stdio: "ignore",
    });
  } catch {
    // 未登録の場合は無視
  }
  execSync(`launchctl load "${plistPath}"`);
  console.log(`LaunchAgent registered: ${plistPath}`);
}

/**
 * Windows: PowerShell で Register-ScheduledTask を使いタスクスケジューラに登録する。
 * schtasks では複数トリガーを1回で登録できないため、
 * 一時的な .ps1 ファイルを書き出して PowerShell で実行する。
 *
 * 登録されるトリガー:
 *   - AtLogOn: ユーザーログイン時に自動実行
 *   - RepetitionInterval 1h: 以降1時間ごとに繰り返し
 *
 * バッテリー駆動時やスリープ復帰後にも動作するよう設定する。
 */
export function enableScheduledTask(nodePath, pullScript) {
  const tmpDir = process.env.TEMP || process.env.TMP || ".";
  const psPath = join(tmpDir, `${TASK_NAME}-setup.ps1`);

  const escaped = (s) => s.replace(/'/g, "''");
  const psScript = [
    `$action = New-ScheduledTaskAction -Execute '${escaped(
      nodePath
    )}' -Argument '"${escaped(pullScript)}"'`,
    `$triggerLogon = New-ScheduledTaskTrigger -AtLogOn`,
    `$triggerRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)`,
    `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger @($triggerLogon, $triggerRepeat) -Settings $settings -Force`,
  ].join("\n");

  writeFileSync(psPath, psScript, "utf-8");
  try {
    execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`,
      { stdio: "inherit" }
    );
  } finally {
    // 成功・失敗に関わらず一時ファイルを削除する
    if (existsSync(psPath)) unlinkSync(psPath);
  }
  console.log(`Scheduled task registered: ${TASK_NAME}`);
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

export function main() {
  try {
    console.log("=== Cursor Settings Sync: Enable ===\n");

    console.log("[1/3] Backing up current settings...");
    backupSettings();

    console.log("\n[2/3] Creating symlink...");
    createSymlink();

    console.log("\n[3/3] Enabling periodic pull...");
    enablePeriodicPull();

    console.log("\nSync enabled successfully!");
  } catch (error) {
    console.error("\nFailed to enable sync:", error.message);
    // Windows でシンボリックリンク作成に失敗した場合は開発者モードの案内を表示
    if (process.platform === "win32" && error.message.includes("symlink")) {
      console.error(
        "\nOn Windows, symlink creation may require Developer Mode to be enabled."
      );
      console.error(
        "Settings > Update & Security > For developers > Developer Mode"
      );
    }
    process.exit(1);
  }
}

const thisFilePath = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(thisFilePath);
if (isDirectRun) {
  main();
}
