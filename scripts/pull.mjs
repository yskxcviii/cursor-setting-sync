/**
 * 定期 pull スクリプト
 *
 * リポジトリのルートで `git pull origin main` を実行し、
 * 結果を logs/pull.log にタイムスタンプ付きで記録する。
 *
 * Mac では launchd、Windows ではタスクスケジューラから
 * 1時間ごとにバックグラウンドで呼び出される想定。
 * 手動で実行する場合は `npm run pull` を使用する。
 */

import { execSync } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { REPO_ROOT, log } from "./utils.mjs";

export function pull() {
  try {
    const output = execSync("git pull origin main", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const message = output.trim();
    log(`SUCCESS: ${message}`);
    console.log(message);
  } catch (error) {
    const message = error.stderr?.trim() || error.message;
    log(`ERROR: ${message}`);
    console.error("git pull failed:", message);
    process.exit(1);
  }
}

const thisFilePath = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(thisFilePath);
if (isDirectRun) {
  pull();
}
