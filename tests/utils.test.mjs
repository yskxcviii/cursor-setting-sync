import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

const originalPlatform = process.platform;
const originalAppData = process.env.APPDATA;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function restorePlatform() {
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
}

describe("scripts/utils.mjs", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    restorePlatform();
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    vi.restoreAllMocks();
  });

  it("getSettingsDir() returns Mac path on darwin", async () => {
    setPlatform("darwin");
    const { getSettingsDir } = await import("../scripts/utils.mjs");

    expect(getSettingsDir()).toMatch(
      /Library[\\/]Application Support[\\/]Cursor[\\/]User$/
    );
  });

  it("getSettingsDir() returns Windows path on win32", async () => {
    setPlatform("win32");
    process.env.APPDATA = "/tmp/appdata";
    const { getSettingsDir } = await import("../scripts/utils.mjs");

    expect(getSettingsDir()).toBe(join("/tmp/appdata", "Cursor", "User"));
  });

  it("getSettingsDir() throws on unsupported platform", async () => {
    setPlatform("linux");
    const { getSettingsDir } = await import("../scripts/utils.mjs");

    expect(() => getSettingsDir()).toThrow(/Unsupported platform/);
  });

  it("path helpers are stable and end with expected suffixes", async () => {
    const {
      REPO_ROOT,
      getSettingsPath,
      getBackupDir,
      getBackupPath,
      getRepoSettingsPath,
      getLogPath,
    } = await import("../scripts/utils.mjs");

    expect(getBackupDir()).toBe(join(REPO_ROOT, "original-settings"));
    expect(getBackupPath()).toBe(
      join(REPO_ROOT, "original-settings", "settings.json")
    );
    expect(getRepoSettingsPath()).toBe(join(REPO_ROOT, "settings.json"));
    expect(getLogPath()).toBe(join(REPO_ROOT, "logs", "pull.log"));

    setPlatform("darwin");
    expect(getSettingsPath()).toMatch(/Cursor[\\/]User[\\/]settings\.json$/);
  });

  it("log() creates logs dir if missing and appends timestamped entry", async () => {
    setPlatform("darwin");

    const appendFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const existsSync = vi.fn().mockReturnValue(false);

    vi.doMock("fs", () => ({
      appendFileSync,
      mkdirSync,
      existsSync,
    }));

    const { log } = await import("../scripts/utils.mjs");
    log("HELLO");

    expect(mkdirSync).toHaveBeenCalledTimes(1);
    expect(appendFileSync).toHaveBeenCalledTimes(1);

    const [, entry] = appendFileSync.mock.calls[0];
    expect(entry).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] HELLO\n$/);
  });
});

