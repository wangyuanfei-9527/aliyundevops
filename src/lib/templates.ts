import { readFile } from "fs/promises";
import path from "path";

export async function renderTemplate(fileName: string, vars: Record<string, string | number>) {
  const file = await readFile(path.join(process.cwd(), "templates", fileName), "utf8");
  return file.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? "" : String(value);
  });
}
