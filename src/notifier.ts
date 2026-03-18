import axios from "axios";
import { Grade } from "./types";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

export class TelegramNotifier {
  private readonly apiUrl: string;
  private readonly chatId: string;
  private offset = 0;

  constructor(botToken: string, chatId: string) {
    this.apiUrl = `https://api.telegram.org/bot${botToken}`;
    this.chatId = chatId;
  }

  async sendMessage(text: string): Promise<void> {
    await axios.post(`${this.apiUrl}/sendMessage`, {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
    });
  }

  async notifyNewGrades(newGrades: Grade[], changedGrades: Grade[]): Promise<void> {
    const lines: string[] = [];

    if (newGrades.length > 0) {
      lines.push("🎓 <b>Neue Note(n) eingetragen!</b>\n");
      for (const g of newGrades) {
        lines.push(this.formatGrade(g));
      }
    }

    if (changedGrades.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("✏️ <b>Bessere Note eingetragen!</b>\n");
      for (const g of changedGrades) {
        lines.push(this.formatGrade(g));
      }
    }

    if (lines.length === 0) return;

    await this.sendMessage(lines.join("\n"));
  }

  async sendAllGrades(grades: Record<string, Grade>, semesterFilter?: string): Promise<void> {
    let list = Object.values(grades).filter(
      (g) => g.grade && g.grade !== "-" && g.grade !== ""
    );

    if (semesterFilter) {
      const f = semesterFilter.toLowerCase().replace(/\s+/g, "");
      list = list.filter((g) => g.semester.toLowerCase().replace(/\s+/g, "").includes(f));
    }

    if (list.length === 0) {
      await this.sendMessage(
        semesterFilter
          ? `📭 Keine Noten für Semester "<b>${semesterFilter}</b>" gefunden.`
          : "📭 Noch keine Noten gespeichert."
      );
      return;
    }

    // Nach Note sortieren (beste zuerst)
    list.sort((a, b) => {
      const nA = parseFloat(a.grade.replace(",", "."));
      const nB = parseFloat(b.grade.replace(",", "."));
      if (isNaN(nA) && isNaN(nB)) return 0;
      if (isNaN(nA)) return 1;
      if (isNaN(nB)) return -1;
      return nA - nB;
    });

    const title = semesterFilter
      ? `📋 <b>Noten – ${semesterFilter}:</b>\n`
      : "📋 <b>Alle gespeicherten Noten:</b>\n";
    const lines = [title];
    for (const g of list) {
      lines.push(`• <b>${g.name}</b>: ${g.grade}`);
    }

    await this.sendMessage(lines.join("\n"));
  }

  async sendAverage(grades: Record<string, Grade>): Promise<void> {
    const numeric = Object.values(grades)
      .map((g) => parseFloat(g.grade.replace(",", ".")))
      .filter((n) => !isNaN(n) && n !== 5.0);

    if (numeric.length === 0) {
      await this.sendMessage("📭 Keine bewerteten Noten für Durchschnittsberechnung vorhanden.");
      return;
    }

    const avg = numeric.reduce((sum, n) => sum + n, 0) / numeric.length;
    const avgFormatted = avg.toFixed(2).replace(".", ",");

    await this.sendMessage(
      `📊 <b>Notendurchschnitt</b>\n\n` +
      `Ø <b>${avgFormatted}</b> (aus ${numeric.length} bestandenen Prüfungen)`
    );
  }

  private formatGrade(g: Grade): string {
    const parts: string[] = [`📋 <b>${g.name}</b>`];
    if (g.grade) parts.push(`Note: <b>${g.grade}</b>`);
    if (g.status) parts.push(`Status: ${g.status}`);
    if (g.credits) parts.push(`ECTS: ${g.credits}`);
    if (g.semester) parts.push(`Semester: ${g.semester}`);
    if (g.date) parts.push(`Datum: ${g.date}`);
    return parts.join(" | ");
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.apiUrl}/getMe`);
      const data = response.data as { ok: boolean; result: { username: string } };
      console.log(`Telegram-Bot verbunden: @${data.result.username}`);
      return data.ok;
    } catch {
      console.error("Telegram-Verbindung fehlgeschlagen.");
      return false;
    }
  }

  /**
   * Startet Long-Polling und ruft `onCommand` auf wenn ein Befehl eingeht.
   * Läuft dauerhaft im Hintergrund.
   */
  startPolling(onCommand: (command: string, args: string) => Promise<void>): void {
    const poll = async () => {
      while (true) {
        try {
          const response = await axios.get(`${this.apiUrl}/getUpdates`, {
            params: { offset: this.offset, timeout: 30 },
            timeout: 35000,
          });

          const data = response.data as { ok: boolean; result: TelegramUpdate[] };
          if (!data.ok) continue;

          for (const update of data.result) {
            this.offset = update.update_id + 1;

            const text = update.message?.text?.trim() ?? "";
            const fromChatId = String(update.message?.chat.id ?? "");

            // Nur Nachrichten aus dem konfigurierten Chat akzeptieren
            if (fromChatId !== this.chatId) continue;

            if (text.startsWith("/")) {
              const parts = text.split(" ");
              const command = parts[0]!.toLowerCase();
              const args = parts.slice(1).join(" ");
              console.log(`Befehl empfangen: ${command} ${args}`.trim());
              try {
                await onCommand(command, args);
              } catch (err) {
                console.error("Fehler beim Verarbeiten des Befehls:", err);
              }
            } else if (text.length > 0) {
              await onCommand("/help", "");
            }
          }
        } catch {
          // Kurz warten bei Verbindungsfehlern, dann weiter pollen
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    };

    poll();
  }
}
