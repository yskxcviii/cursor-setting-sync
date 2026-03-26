import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const originalPlatform = process.platform;
const originalHome = process.env.HOME;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function restorePlatform() {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
}

describe("scripts/disable.mjs", () => {
  let baseDir;
  let settingsPath;
  let backupDir;
  let backupPath;
  let tmpHome;

  beforeEach(async () => {
    vi.resetModules();

    baseDir = mkdtempSync(join(tmpdir(), "cursor-settings-test-"));
    settingsPath = join(baseDir, "cursor-user", "settings.json");
    backupDir = join(baseDir, "original-settings");
    backupPath = join(backupDir, "settings.json");
    tmpHome = join(baseDir, "home");

    mkdirSync(join(baseDir, "cursor-user"), { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(tmpHome, { recursive: true });

    process.env.HOME = tmpHome;

    vi.doMock("../scripts/utils.mjs", async (importOriginal) => {
      const original = await importOriginal();
      return {
        ...original,
        getSettingsPath: vi.fn(() => settingsPath),
        getBackupDir: vi.fn(() => backupDir),
        getBackupPath: vi.fn(() => backupPath),
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
    rmSync(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("disableLaunchAgent() skips when plist missing", async () => {
    setPlatform("darwin");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { disableLaunchAgent } = await import("../scripts/disable.mjs");

    disableLaunchAgent();

    expect(logSpy).toHaveBeenCalledWith("LaunchAgent not found. Skipping.");
  });

  it("disableLaunchAgent() unloads and deletes plist if present", async () => {
    setPlatform("darwin");
    const plistDir = join(tmpHome, "Library", "LaunchAgents");
    mkdirSync(plistDir, { recursive: true });
    const plistPath = join(plistDir, "com.cursor-settings-sync.plist");
    writeFileSync(plistPath, "<plist/>", "utf-8");

    const { disableLaunchAgent } = await import("../scripts/disable.mjs");
    const { execSync } = await import("child_process");

    disableLaunchAgent();

    expect(execSync).toHaveBeenCalled();
    expect(existsSync(plistPath)).toBe(false);
  });

  it("disableScheduledTask() calls schtasks delete and ignores errors", async () => {
    setPlatform("win32");
    const { disableScheduledTask } = await import("../scripts/disable.mjs");
    const { execSync } = await import("child_process");

    disableScheduledTask();
    expect(execSync).toHaveBeenCalledWith(
      'schtasks /delete /tn "CursorSettingsSync" /f',
      expect.any(Object)
    );
  });

  it("removeSymlink() removes symlink settings.json", async () => {
    const { symlinkSync } = await import("fs");
    writeFileSync(join(baseDir, "real.json"), "{\n}\n", "utf-8");
    symlinkSync(join(baseDir, "real.json"), settingsPath);

    const { removeSymlink } = await import("../scripts/disable.mjs");
    removeSymlink();

    expect(existsSync(settingsPath)).toBe(false);
  });

  it("removeSymlink() skips if settings.json is not a symlink", async () => {
    writeFileSync(settingsPath, "{\n  \"x\": 1\n}\n", "utf-8");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { removeSymlink } = await import("../scripts/disable.mjs");

    removeSymlink();

    expect(logSpy).toHaveBeenCalledWith(
      "settings.json is not a symlink. Skipping removal."
    );
    expect(lstatSync(settingsPath).isFile()).toBe(true);
  });

  it("restoreSettings() copies backup into settings and removes backupDir", async () => {
    writeFileSync(backupPath, "{\n  \"restored\": true\n}\n", "utf-8");

    const { restoreSettings } = await import("../scripts/disable.mjs");
    restoreSettings();

    expect(readFileSync(settingsPath, "utf-8")).toContain("\"restored\": true");
    expect(existsSync(backupDir)).toBe(false);
  });

  it("restoreSettings() logs error when backup missing", async () => {
    rmSync(backupDir, { recursive: true, force: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { restoreSettings } = await import("../scripts/disable.mjs");

    restoreSettings();

    expect(errSpy).toHaveBeenCalledWith(
      "Backup not found. Cannot restore original settings.json."
    );
  });
});

