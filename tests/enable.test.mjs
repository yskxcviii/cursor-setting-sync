import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const originalPlatform = process.platform;
const originalHome = process.env.HOME;
const originalTemp = process.env.TEMP;
const originalTmp = process.env.TMP;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function restorePlatform() {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
}

describe("scripts/enable.mjs", () => {
  let baseDir;
  let settingsPath;
  let backupDir;
  let backupPath;
  let repoSettingsPath;
  let tmpHome;

  beforeEach(async () => {
    vi.resetModules();

    baseDir = mkdtempSync(join(tmpdir(), "cursor-settings-test-"));
    settingsPath = join(baseDir, "cursor-user", "settings.json");
    backupDir = join(baseDir, "original-settings");
    backupPath = join(backupDir, "settings.json");
    repoSettingsPath = join(baseDir, "repo", "settings.json");
    tmpHome = join(baseDir, "home");

    mkdirSync(join(baseDir, "cursor-user"), { recursive: true });
    mkdirSync(join(baseDir, "repo"), { recursive: true });
    mkdirSync(tmpHome, { recursive: true });
    writeFileSync(repoSettingsPath, '{\n  "fromRepo": true\n}\n', "utf-8");

    process.env.HOME = tmpHome;
    process.env.TEMP = join(baseDir, "tmp");
    process.env.TMP = join(baseDir, "tmp2");
    mkdirSync(process.env.TEMP, { recursive: true });
    mkdirSync(process.env.TMP, { recursive: true });

    vi.doMock("../scripts/utils.mjs", async (importOriginal) => {
      const original = await importOriginal();
      return {
        ...original,
        getSettingsPath: vi.fn(() => settingsPath),
        getBackupDir: vi.fn(() => backupDir),
        getBackupPath: vi.fn(() => backupPath),
        getRepoSettingsPath: vi.fn(() => repoSettingsPath),
      };
    });

    vi.doMock("child_process", () => ({
      execSync: vi.fn(),
    }));

    vi.doMock("os", async (importOriginal) => {
      const orig = await importOriginal();
      return {
        ...orig,
        homedir: () => tmpHome,
      };
    });
  });

  afterEach(() => {
    restorePlatform();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP;
    else process.env.TMP = originalTmp;
    rmSync(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("backupSettings() copies existing settings.json into backup", async () => {
    writeFileSync(settingsPath, '{\n  "a": 1\n}\n', "utf-8");

    const { backupSettings } = await import("../scripts/enable.mjs");
    backupSettings();

    expect(readFileSync(backupPath, "utf-8")).toContain('"a": 1');
  });

  it("backupSettings() skips when settings.json is a symlink", async () => {
    // create a symlink at settingsPath
    writeFileSync(join(baseDir, "real.json"), '{\n  "x": 1\n}\n', "utf-8");
    // ensure parent exists
    // symlink target doesn't matter, just need isSymbolicLink() true
    const { symlinkSync } = await import("fs");
    symlinkSync(join(baseDir, "real.json"), settingsPath);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { backupSettings } = await import("../scripts/enable.mjs");
    backupSettings();

    expect(logSpy).toHaveBeenCalledWith(
      "settings.json is already a symlink. Skipping backup.",
    );
    expect(existsSync(backupPath)).toBe(false);
  });

  it("backupSettings() creates empty backup when settings.json is missing", async () => {
    const { backupSettings } = await import("../scripts/enable.mjs");
    backupSettings();

    expect(readFileSync(backupPath, "utf-8")).toBe("{}\n");
  });

  it("createSymlink() creates symlink to repo settings", async () => {
    const { createSymlink } = await import("../scripts/enable.mjs");
    createSymlink();

    const stat = lstatSync(settingsPath);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(readlinkSync(settingsPath)).toBe(repoSettingsPath);
  });

  it("createSymlink() replaces existing regular file", async () => {
    writeFileSync(settingsPath, '{\n  "old": true\n}\n', "utf-8");

    const { createSymlink } = await import("../scripts/enable.mjs");
    createSymlink();

    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(settingsPath)).toBe(repoSettingsPath);
  });

  it("createSymlink() skips when symlink already exists", async () => {
    const { symlinkSync } = await import("fs");
    symlinkSync(repoSettingsPath, settingsPath);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { createSymlink } = await import("../scripts/enable.mjs");
    createSymlink();

    expect(logSpy).toHaveBeenCalledWith("Symlink already exists. Skipping.");
  });

  it("enableLaunchAgent() writes plist and calls launchctl unload/load", async () => {
    setPlatform("darwin");
    const { enableLaunchAgent } = await import("../scripts/enable.mjs");
    const { execSync } = await import("child_process");

    const nodePath = "/usr/local/bin/node";
    const pullScript = "/tmp/pull.mjs";
    enableLaunchAgent(nodePath, pullScript);

    const plistPath = join(
      tmpHome,
      "Library",
      "LaunchAgents",
      "com.cursor-settings-sync.plist",
    );
    expect(existsSync(plistPath)).toBe(true);
    const contents = readFileSync(plistPath, "utf-8");
    expect(contents).toContain("<string>com.cursor-settings-sync</string>");
    expect(contents).toContain(`<string>${nodePath}</string>`);
    expect(contents).toContain(`<string>${pullScript}</string>`);
    expect(contents).toContain("<integer>3600</integer>");

    expect(execSync).toHaveBeenCalled();
    const calls = execSync.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("launchctl unload"))).toBe(true);
    expect(calls.some((c) => c.includes("launchctl load"))).toBe(true);
  });

  it("enableScheduledTask() writes ps1, calls powershell, then deletes ps1", async () => {
    setPlatform("win32");
    const { enableScheduledTask } = await import("../scripts/enable.mjs");
    const { execSync } = await import("child_process");

    const nodePath = "C:\\\\node\\\\node.exe";
    const pullScript = "C:\\\\repo\\\\pull.mjs";
    enableScheduledTask(nodePath, pullScript);

    const tmpDir = process.env.TEMP;
    const psPath = join(tmpDir, "CursorSettingsSync-setup.ps1");
    expect(existsSync(psPath)).toBe(false);
    expect(execSync).toHaveBeenCalled();
    expect(execSync.mock.calls[0][0]).toContain("powershell");
  });

  it("enableScheduledTask() writes ps1 with ErrorAction Stop for PowerShell", async () => {
    setPlatform("win32");
    const { enableScheduledTask } = await import("../scripts/enable.mjs");
    const { execSync } = await import("child_process");
    const tmpDir = process.env.TEMP;
    const psPath = join(tmpDir, "CursorSettingsSync-setup.ps1");
    let captured = "";
    execSync.mockImplementation(() => {
      if (existsSync(psPath)) {
        captured = readFileSync(psPath, "utf-8");
      }
    });

    const nodePath = "C:\\\\node\\\\node.exe";
    const pullScript = "C:\\\\repo\\\\pull.mjs";
    enableScheduledTask(nodePath, pullScript);

    expect(captured).toContain("$ErrorActionPreference = 'Stop'");
    expect(captured).toContain("-ErrorAction Stop");
  });

  it("enableScheduledTask() propagates when execSync fails", async () => {
    setPlatform("win32");
    const { enableScheduledTask } = await import("../scripts/enable.mjs");
    const { execSync } = await import("child_process");
    execSync.mockImplementation(() => {
      throw new Error("Command failed with status 1");
    });

    expect(() =>
      enableScheduledTask("C:\\\\node\\\\node.exe", "C:\\\\repo\\\\pull.mjs"),
    ).toThrow("Command failed with status 1");
  });

  it("enablePeriodicPull() dispatches by platform", async () => {
    const { enablePeriodicPull } = await import("../scripts/enable.mjs");
    const { execSync } = await import("child_process");

    setPlatform("darwin");
    enablePeriodicPull();
    expect(
      execSync.mock.calls
        .map((c) => c[0])
        .some((c) => c.includes("launchctl load")),
    ).toBe(true);

    execSync.mockClear();

    setPlatform("win32");
    enablePeriodicPull();
    expect(
      execSync.mock.calls
        .map((c) => c[0])
        .some((c) => c.includes("powershell")),
    ).toBe(true);
  });

  it("enablePeriodicPull() exits on unsupported platform", async () => {
    const { enablePeriodicPull } = await import("../scripts/enable.mjs");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    setPlatform("linux");
    expect(() => enablePeriodicPull()).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
