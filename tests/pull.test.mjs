import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("scripts/pull.mjs", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pull() logs SUCCESS when git pull succeeds", async () => {
    const execSync = vi.fn().mockReturnValue("Already up to date.\n");
    vi.doMock("child_process", () => ({ execSync }));

    const log = vi.fn();
    vi.doMock("../scripts/utils.mjs", async (importOriginal) => {
      const original = await importOriginal();
      return { ...original, log };
    });

    const { pull } = await import("../scripts/pull.mjs");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    pull();

    expect(execSync).toHaveBeenCalledWith(
      "git pull origin main",
      expect.objectContaining({
        cwd: expect.any(String),
        encoding: "utf-8",
        timeout: 30_000,
      })
    );
    expect(log).toHaveBeenCalledWith("SUCCESS: Already up to date.");
    expect(consoleSpy).toHaveBeenCalledWith("Already up to date.");
  });

  it("pull() logs ERROR and exits when git pull fails", async () => {
    const execSync = vi.fn().mockImplementation(() => {
      const err = new Error("failed");
      err.stderr = "fatal: bad\n";
      throw err;
    });
    vi.doMock("child_process", () => ({ execSync }));

    const log = vi.fn();
    vi.doMock("../scripts/utils.mjs", async (importOriginal) => {
      const original = await importOriginal();
      return { ...original, log };
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { pull } = await import("../scripts/pull.mjs");

    expect(() => pull()).toThrow("exit");
    expect(log).toHaveBeenCalledWith("ERROR: fatal: bad");
    expect(errSpy).toHaveBeenCalledWith("git pull failed:", "fatal: bad");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

