export interface Grade {
  /** Eindeutiger Schlüssel aus Modul-ID + Prüfungsnummer */
  id: string;
  /** Name des Moduls / der Prüfung */
  name: string;
  /** Semester, in dem die Prüfung abgelegt wurde */
  semester: string;
  /** Note als String (z.B. "1,3" oder "bestanden") */
  grade: string;
  /** Status (z.B. "bestanden", "nicht bestanden", "angemeldet") */
  status: string;
  /** Datum der Eintragung, falls vorhanden */
  date: string;
  /** Kreditpunkte / ECTS */
  credits: string;
}

export interface GradeStore {
  lastCheck: string;
  grades: Record<string, Grade>;
}

export interface Config {
  username: string;
  password: string;
  telegramBotToken: string;
  telegramChatId: string;
  checkIntervalMinutes: number;
}
