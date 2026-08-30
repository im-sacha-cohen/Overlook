import path from "node:path";

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}
