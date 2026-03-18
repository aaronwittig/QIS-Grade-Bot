# QIS Notenbenachrichtigung – Leibniz Uni Hannover

Crawlt automatisch das QIS der LUH und sendet eine Telegram-Nachricht, sobald eine neue Note eingetragen wurde. Unterstützt Befehle per Telegram-Bot zum Abrufen von Noten, Durchschnitt und mehr.

---

## Voraussetzungen

Folgende Programme müssen installiert sein:

### Node.js (Version 18 oder neuer)

Prüfen ob bereits installiert:
```bash
node --version
```

Falls nicht installiert: [nodejs.org/de/download](https://nodejs.org/de/download) → LTS-Version herunterladen und installieren.

### npm (wird mit Node.js mitgeliefert)

```bash
npm --version
```

### PM2 (Prozessmanager, um den Bot dauerhaft laufen zu lassen)

```bash
npm install -g pm2
```

---

## Installation

### 1. Repository klonen

```bash
git clone <repo-url>
cd QIS_SKRIPT
```

### 2. Abhängigkeiten installieren

```bash
npm install
```

### 3. Telegram Bot erstellen

1. Öffne Telegram und schreibe **[@BotFather](https://t.me/BotFather)**
2. Sende `/newbot` und folge den Anweisungen (Name und Username vergeben)
3. Du erhältst einen **Bot Token** – sieht so aus: `123456789:ABCdefGHIjklMNO...`
4. Schreibe deinem neuen Bot eine beliebige Nachricht (z.B. "Hallo") – das ist wichtig für den nächsten Schritt
5. Öffne diese URL im Browser (Token ersetzen):
   ```
   https://api.telegram.org/bot<DEIN_TOKEN>/getUpdates
   ```
6. In der Antwort findest du `"chat": { "id": 123456789 }` – das ist deine **Chat-ID**

### 4. Konfiguration anlegen

```bash
cp .env.example .env
```

Öffne die `.env`-Datei und trage deine Daten ein:

```env
# QIS-Zugangsdaten (Matrikelnummer + Passwort)
QIS_USERNAME=deine_matrikelnummer
QIS_PASSWORD=dein_passwort

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=123456789

# Wie oft geprüft werden soll (in Minuten, Standard: 60)
CHECK_INTERVAL_MINUTES=60
```

> **Wichtig:** Die `.env`-Datei enthält deine Zugangsdaten und darf **nicht** ins Git hochgeladen werden. Sie ist bereits in `.gitignore` eingetragen.

### 5. Projekt bauen

```bash
npm run build
```

### 6. Bot starten

```bash
pm2 start dist/index.js --name qis-notifier
```

Der Bot läuft jetzt im Hintergrund und prüft automatisch auf neue Noten – zwischen **8:00 und 20:00 Uhr** im eingestellten Intervall.

---

## Bot-Befehle

Folgende Befehle können direkt im Telegram-Chat mit dem Bot verwendet werden:

| Befehl | Beschreibung |
|--------|--------------|
| `/noten` | Alle gespeicherten Noten anzeigen |
| `/durchschnitt` | Notendurchschnitt berechnen |
| `/offen` | Angemeldete Prüfungen ohne Note anzeigen |
| `/checknow` | Sofort auf neue Noten prüfen |
| `/aufdecken` | Neue Note mit Countdown aufdecken (Spannungsmoment) |
| `/status` | Bot-Status, letzter Check, Intervall |
| `/interval [Min]` | Check-Intervall ändern, z.B. `/interval 30` |
| `/pause` | Automatische Checks pausieren |
| `/resume` | Automatische Checks fortsetzen |
| `/reset` | Alle gespeicherten Noten löschen (z.B. bei Semesterwechsel) |
| `/echo` | Prüfen ob der Bot online ist |
| `/help` | Alle Befehle anzeigen |

### Wie funktioniert die Notenbenachrichtigung?

Wenn eine neue Note eingetragen wird, schickt der Bot eine Nachricht:

> 🎓 **1 neue Note eingetragen!**
> Tippe /aufdecken um die Note zu sehen. 👀

Mit `/aufdecken` startet ein Countdown (3... 2... 1...) bevor die Note angezeigt wird.

---

## PM2-Befehle (Prozessverwaltung)

```bash
# Status anzeigen
pm2 status

# Logs anzeigen
pm2 logs qis-notifier

# Bot neu starten
pm2 restart qis-notifier

# Bot stoppen
pm2 stop qis-notifier

# Bot entfernen
pm2 delete qis-notifier
```

### Bot nach Systemneustart automatisch starten

```bash
pm2 startup
pm2 save
```

---

## Testen ohne dauerhaften Betrieb

```bash
# Einmalig prüfen und Telegram-Nachricht senden (zum Testen):
npm run build && node dist/index.js --once

# Nur prüfen, keine Benachrichtigung senden:
npm run check
```

---

## Datei-Struktur

```
.
├── src/
│   ├── index.ts      # Einstiegspunkt & Bot-Logik
│   ├── crawler.ts    # QIS-Login und Noten-Parsing
│   ├── notifier.ts   # Telegram-Benachrichtigung & Polling
│   ├── storage.ts    # Noten speichern & vergleichen
│   ├── config.ts     # Konfiguration aus .env
│   └── types.ts      # TypeScript-Typen
├── dist/             # Kompilierter JavaScript-Code (nach npm run build)
├── grades.json       # Gespeicherte Noten (wird automatisch erstellt)
├── .env              # Zugangsdaten (NICHT ins Git!)
└── .env.example      # Vorlage für .env
```

---

## Hinweise

- **Sei nett zum Server :)** Bitte respektiere den QIS Server und stelle das Intervall nicht auf < 15 min.
- **Erster Start:** Alle aktuellen Noten werden gespeichert, aber **nicht** gemeldet. Ab dem zweiten Check werden nur neue oder geänderte Noten gemeldet.
- **Nur LUH:** Das Tool ist auf das QIS der Leibniz Universität Hannover ausgelegt (Studiengang Informatik). Bei anderen Studiengängen muss ggf. `crawler.ts` angepasst werden.
- **Datenschutz:** Zugangsdaten liegen ausschließlich lokal in der `.env`-Datei und verlassen deinen Rechner nicht. Für eine 24/7 Uptime würde ich **keine externen Server Provider** empfehlen, da das Passwort in Klartext gespeichert werden muss!
- **QIS-Änderungen:** Falls die QIS-Seite ihre Struktur ändert, muss `crawler.ts` ggf. angepasst werden.