import { loadConfig } from "./config";
import { QisCrawler } from "./crawler";
import { TelegramNotifier } from "./notifier";
import { loadStore, saveStore, detectChanges, isBetterGrade } from "./storage";
import { Grade, GradeStore } from "./types";

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check-only");
const ONCE = args.includes("--once");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCheck(
  notifyOnNoChanges = false,
  onNewGrades?: (newGrades: Grade[], changedGrades: Grade[]) => Promise<void>
): Promise<void> {
  const config = loadConfig();
  const crawler = new QisCrawler();
  const notifier = new TelegramNotifier(
    config.telegramBotToken,
    config.telegramChatId
  );

  console.log(`[${new Date().toLocaleString("de-DE")}] Prüfe auf neue Noten...`);

  // Login
  await crawler.login(config.username, config.password);

  // Noten abrufen
  const currentGrades = await crawler.fetchGrades();
  console.log(`${currentGrades.length} Prüfung(en) gefunden.`);

  if (currentGrades.length === 0) {
    console.warn(
      "Keine Noten gefunden. Möglicherweise hat sich die QIS-Seitenstruktur geändert."
    );
  }

  // Mit gespeicherten Noten vergleichen
  const store = loadStore();
  const { newGrades, changedGrades } = detectChanges(
    store.grades,
    currentGrades
  );

  if (newGrades.length > 0 || changedGrades.length > 0) {
    console.log(
      `${newGrades.length} neue, ${changedGrades.length} geänderte Note(n) gefunden!`
    );
    if (!CHECK_ONLY) {
      if (onNewGrades) {
        await onNewGrades(newGrades, changedGrades);
      } else {
        await notifier.notifyNewGrades(newGrades, changedGrades);
        console.log("Telegram-Benachrichtigung gesendet.");
      }
    } else {
      console.log("(--check-only: keine Benachrichtigung gesendet)");
      for (const g of [...newGrades, ...changedGrades]) {
        console.log(`  - ${g.name}: ${g.grade} (${g.status})`);
      }
    }
  } else {
    console.log("Keine neuen Noten.");
    if (notifyOnNoChanges) {
      await notifier.sendMessage("📭 Keine neuen Noten gefunden.");
    }
  }

  // Store aktualisieren — pro Modul nur die beste Note behalten
  const updatedGrades: Record<string, Grade> = { ...store.grades };
  for (const g of currentGrades) {
    const existing = updatedGrades[g.id];
    if (!existing || !existing.grade || existing.grade === "-" || isBetterGrade(g.grade, existing.grade)) {
      updatedGrades[g.id] = g;
    }
  }

  const updatedStore: GradeStore = {
    lastCheck: new Date().toISOString(),
    grades: updatedGrades,
  };
  saveStore(updatedStore);
}

async function main(): Promise<void> {
  if (ONCE || CHECK_ONLY) {
    await runCheck();
    return;
  }

  const config = loadConfig();
  const notifier = new TelegramNotifier(config.telegramBotToken, config.telegramChatId);

  let paused = false;
  let currentIntervalMinutes = config.checkIntervalMinutes;
  let intervalId: NodeJS.Timeout;

  let pendingGrades: Grade[] = [];
  let pendingChangedGrades: Grade[] = [];

  const onNewGrades = async (newGrades: Grade[], changedGrades: Grade[]): Promise<void> => {
    pendingGrades.push(...newGrades);
    pendingChangedGrades.push(...changedGrades);
    const count = newGrades.length + changedGrades.length;
    await notifier.sendMessage(
      `🎓 <b>${count} neue Note(n) eingetragen!</b>\n\n` +
      `Tippe /aufdecken um ${count === 1 ? "die Note" : "die Noten"} zu sehen. 👀`
    );
    console.log("Telegram-Benachrichtigung gesendet.");
  };

  function startInterval(): void {
    clearInterval(intervalId);
    intervalId = setInterval(async () => {
      if (paused) return;
      const hour = new Date().getHours();
      if (hour < 8 || hour >= 20) {
        console.log(`[${new Date().toLocaleString("de-DE")}] Außerhalb der Prüfzeit (8–20 Uhr), überspringe Check.`);
        return;
      }
      try {
        await runCheck(false, onNewGrades);
      } catch (err) {
        console.error("Fehler beim Prüfen:", err);
      }
    }, currentIntervalMinutes * 60 * 1000);
  }

  console.log("=== QIS Notenbenachrichtigung ===");
  console.log(`Prüfintervall: ${currentIntervalMinutes} Minuten`);
  console.log('Beenden mit Ctrl+C, oder "--once" für einmalige Prüfung\n');

  // Bot-Commands per Polling empfangen
  notifier.startPolling(async (command, args) => {
    if (command === "/noten") {
      const store = loadStore();
      await notifier.sendAllGrades(store.grades);
    } else if (command === "/durchschnitt") {
      const store = loadStore();
      await notifier.sendAverage(store.grades);
    } else if (command === "/offen") {
      const store = loadStore();
      const offen = Object.values(store.grades).filter(
        (g) => g.status?.toLowerCase() === "angemeldet"
      );
      if (offen.length === 0) {
        await notifier.sendMessage("✅ Keine offenen Prüfungen ohne Note.");
      } else {
        const lines = [`📋 <b>Offene Prüfungen (${offen.length}):</b>\n`];
        for (const g of offen) {
          lines.push(`• <b>${g.name}</b>${g.semester ? ` (${g.semester})` : ""}${g.status ? ` – ${g.status}` : ""}`);
        }
        await notifier.sendMessage(lines.join("\n"));
      }
    } else if (command === "/aufdecken") {
      if (pendingGrades.length === 0 && pendingChangedGrades.length === 0) {
        await notifier.sendMessage("📭 Keine Noten zum Aufdecken vorhanden.");
      } else {
        const grades = [...pendingGrades];
        const changed = [...pendingChangedGrades];
        pendingGrades = [];
        pendingChangedGrades = [];
        await notifier.sendMessage("🥁 Gleich ist es soweit...");
        await sleep(1500);
        await notifier.sendMessage("3️⃣");
        await sleep(1000);
        await notifier.sendMessage("2️⃣");
        await sleep(1000);
        await notifier.sendMessage("1️⃣");
        await sleep(1000);
        await notifier.notifyNewGrades(grades, changed);
        await sleep(800);
        const allRevealed = [...grades, ...changed];
        const bestGrade = allRevealed
          .map((g) => parseFloat(g.grade.replace(",", ".")))
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b)[0];
        const hasBestanden = allRevealed.some((g) => g.grade.toLowerCase() === "bestanden");
        let reaction = "";
        if (bestGrade !== undefined) {
          if (bestGrade <= 1.0)       reaction = "🏆 Eine 1,0?! Perfekt – absolut unschlagbar!";
          else if (bestGrade <= 1.3)  reaction = "🌟 Herausragend! Das ist eine Spitzennote!";
          else if (bestGrade <= 1.7)  reaction = "🎉 Sehr gut! Du hast das richtig gut gemacht!";
          else if (bestGrade <= 2.0)  reaction = "👏 Stark! Eine solide 2,0 – kannst stolz sein!";
          else if (bestGrade <= 2.3)  reaction = "😊 Gut! Weiter so!";
          else if (bestGrade <= 2.7)  reaction = "👍 Ganz ordentlich – noch Luft nach oben!";
          else if (bestGrade <= 3.0)  reaction = "✅ Solide Mitte – bestanden ist bestanden!";
          else if (bestGrade <= 3.3)  reaction = "😌 Noch gut durch – Hauptsache bestanden!";
          else if (bestGrade <= 3.7)  reaction = "😅 Knapp aber drin – du hast es geschafft!";
          else if (bestGrade <= 4.0)  reaction = "😤 Gerade noch bestanden – beim nächsten Mal packst du das besser!";
          else                        reaction = "😔 Leider nicht bestanden. Kopf hoch – beim nächsten Versuch klappt's!";
        } else if (hasBestanden) {
          reaction = "✅ Bestanden! Gut gemacht!";
        }
        if (reaction) await notifier.sendMessage(reaction);
      }
    } else if (command === "/status") {
      const store = loadStore();
      const totalGrades = Object.values(store.grades).filter(
        (g) => g.grade && g.grade !== "-" && g.grade !== ""
      ).length;
      const lastCheck = store.lastCheck
        ? new Date(store.lastCheck).toLocaleString("de-DE")
        : "Noch nie";
      const pending = pendingGrades.length + pendingChangedGrades.length;
      await notifier.sendMessage(
        `📊 <b>Bot-Status</b>\n\n` +
        `🕐 Letzter Check: ${lastCheck}\n` +
        `⏱ Intervall: ${currentIntervalMinutes} Minuten\n` +
        `📚 Gespeicherte Noten: ${totalGrades}\n` +
        `${pending > 0 ? `🎓 Aufzudeckende Noten: ${pending}\n` : ""}` +
        `${paused ? "⏸ Automatische Checks: pausiert" : "▶️ Automatische Checks: aktiv"}`
      );
    } else if (command === "/reset") {
      saveStore({ lastCheck: new Date().toISOString(), grades: {} });
      await notifier.sendMessage("🗑 Alle gespeicherten Noten wurden gelöscht.");
    } else if (command === "/interval") {
      const minutes = parseInt(args, 10);
      if (isNaN(minutes) || minutes < 1) {
        await notifier.sendMessage("❌ Ungültige Angabe. Beispiel: <code>/interval 30</code>");
      } else {
        currentIntervalMinutes = minutes;
        startInterval();
        await notifier.sendMessage(`✅ Intervall auf <b>${minutes} Minuten</b> gesetzt.`);
      }
    } else if (command === "/pause") {
      paused = true;
      await notifier.sendMessage("⏸ Automatische Checks pausiert. Mit /resume fortsetzen.");
    } else if (command === "/resume") {
      paused = false;
      await notifier.sendMessage("▶️ Automatische Checks wieder aktiv.");
    } else if (command === "/help") {
      await notifier.sendMessage(
        `📖 <b>Verfügbare Befehle:</b>\n\n` +
        `<b>Noten</b>\n` +
        `/noten – Alle gespeicherten Noten anzeigen\n` +
        `/durchschnitt – Notendurchschnitt berechnen\n` +
        `/offen – Angemeldete Prüfungen anzeigen\n` +
        `/info [Name] – Notenverteilung einer Prüfung\n` +
        `/checknow – Sofort auf neue Noten prüfen\n` +
        `/aufdecken – Neue Note mit Countdown aufdecken\n\n` +
        `<b>Status & Konfiguration</b>\n` +
        `/status – Bot-Status und letzte Prüfzeit\n` +
        `/interval [Min] – Check-Intervall ändern\n` +
        `/pause – Automatische Checks pausieren\n` +
        `/resume – Automatische Checks fortsetzen\n` +
        `/reset – Alle gespeicherten Noten löschen\n\n` +
        `<b>Sonstiges</b>\n` +
        `/echo – Prüfen ob der Bot online ist\n` +
        `/help – Diese Hilfe anzeigen`
      );
    } else if (command === "/info") {
      if (!args) {
        await notifier.sendMessage("❌ Bitte einen Prüfungsnamen angeben.\nBeispiel: <code>/info Rechnerstrukturen</code>");
      } else {
        await notifier.sendMessage(`🔍 Suche Notenverteilung für "<b>${args}</b>"...`);
        try {
          const infoCrawler = new QisCrawler();
          await infoCrawler.login(config.username, config.password);
          const result = await infoCrawler.fetchDistributionForGrade(args);

          if (result.type === "not_found") {
            await notifier.sendMessage(`❌ Keine Prüfung gefunden für "<b>${args}</b>".\n\nTipp: Tippe /noten um alle Prüfungsnamen zu sehen.`);
          } else if (result.type === "multiple") {
            const list = result.names.map((n) => `• ${n}`).join("\n");
            await notifier.sendMessage(`⚠️ Mehrere Treffer – bitte genauer angeben:\n\n${list}`);
          } else {
            const lines = result.entries
              .filter((e) => parseInt(e.count) > 0)
              .map((e) => `<b>${e.range}</b>  →  ${e.count}`);
            let msg = `📊 <b>Notenverteilung – ${result.examName || args}</b>\n\n${lines.join("\n")}`;
            if (result.averageSummary) msg += `\n\n📈 ${result.averageSummary}`;
            await notifier.sendMessage(msg);
          }
        } catch (err) {
          console.error("Fehler bei /info:", err);
          await notifier.sendMessage("❌ Fehler beim Abrufen der Notenverteilung.");
        }
      }
    } else if (command === "/echo") {
      await notifier.sendMessage(`✅ Bot ist online.\n🕐 ${new Date().toLocaleString("de-DE")}`);
    } else if (command === "/checknow") {
      await notifier.sendMessage("🔍 Prüfe auf neue Noten...");
      await runCheck(true, onNewGrades);
    }
  });

  // Sofort beim Start prüfen
  try {
    await runCheck(false, onNewGrades);
  } catch (err) {
    console.error("Fehler beim ersten Durchlauf:", err);
  }

  // Dann periodisch prüfen
  startInterval();
}

main().catch((err) => {
  console.error("Fataler Fehler:", err);
  process.exit(1);
});
