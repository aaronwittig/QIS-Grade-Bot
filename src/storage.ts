import * as fs from "fs";
import * as path from "path";
import { Grade, GradeStore } from "./types";

const STORE_PATH = path.join(process.cwd(), "grades.json");

export function loadStore(): GradeStore {
  if (!fs.existsSync(STORE_PATH)) {
    return { lastCheck: "", grades: {} };
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as GradeStore;
  } catch {
    console.warn("Konnte grades.json nicht lesen, starte neu.");
    return { lastCheck: "", grades: {} };
  }
}

export function saveStore(store: GradeStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

/** Parsed eine deutsche Notenangabe ("1,3", "2,7", ...) in eine Zahl. */
function parseGrade(grade: string): number | null {
  const n = parseFloat(grade.replace(",", "."));
  return isNaN(n) ? null : n;
}

/** Gibt true zurück, wenn `a` besser (kleiner) ist als `b`. */
export function isBetterGrade(a: string, b: string): boolean {
  const nA = parseGrade(a);
  const nB = parseGrade(b);
  if (nA === null || nB === null) return false;
  return nA < nB;
}

/**
 * Vergleicht neue Noten mit gespeicherten.
 * Gibt neue und verbesserte Noten zurück.
 * Bei Wiederholungsprüfungen wird nur gemeldet, wenn die neue Note besser ist.
 */
export function detectChanges(
  stored: Record<string, Grade>,
  current: Grade[]
): { newGrades: Grade[]; changedGrades: Grade[]; worsenedGrades: Grade[] } {
  const newGrades: Grade[] = [];
  const changedGrades: Grade[] = [];
  const worsenedGrades: Grade[] = [];

  for (const grade of current) {
    const hasGrade = grade.grade && grade.grade !== "-" && grade.grade !== "";
    if (!hasGrade) continue;

    const existing = stored[grade.id];

    // Modul bereits als "bestanden" gespeichert → keine weiteren Änderungen melden
    // (verhindert false positives wenn QIS alte 5,0-Versuche neben "bestanden" zeigt)
    if (existing?.status?.toLowerCase() === "bestanden" || existing?.grade?.toLowerCase() === "bestanden") {
      continue;
    }

    if (!existing || !existing.grade || existing.grade === "-") {
      // Noch gar keine Note gespeichert
      newGrades.push(grade);
    } else if (isBetterGrade(grade.grade, existing.grade)) {
      // Bessere Note als bisher gespeichert (z.B. Wiederholungsprüfung)
      changedGrades.push(grade);
    } else if (isBetterGrade(existing.grade, grade.grade)) {
      // Schlechtere Note als bisher gespeichert (z.B. Korrektur)
      worsenedGrades.push(grade);
    }
  }

  return { newGrades, changedGrades, worsenedGrades };
}
