import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { Grade } from "./types";

const BASE_URL = "https://qis.verwaltung.uni-hannover.de";
const LOGIN_URL = `${BASE_URL}/qisserver/rds?state=user&type=1&category=auth.login&startpage=portal.vm`;

export class QisCrawler {
  private client: ReturnType<typeof wrapper>;
  private jar: CookieJar;

  constructor() {
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: BASE_URL,
        jar: this.jar,
        withCredentials: true,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "de-DE,de;q=0.9",
        },
        maxRedirects: 10,
        timeout: 30000,
      })
    );
  }

  // ── Hilfsmethoden ──────────────────────────────────────────────────────────

  private resolve(href: string): string {
    return href.startsWith("http") ? href : `${BASE_URL}${href}`;
  }

  /**
   * Findet den ersten Link, dessen sichtbarer Text den Suchbegriff enthält.
   * Gibt die vollständige URL zurück oder null.
   */
  private findLink(
    $: ReturnType<typeof cheerio.load>,
    ...searchTerms: string[]
  ): string | null {
    let found: string | null = null;
    $("a").each((_, el) => {
      if (found) return;
      const text = $(el).text().trim();
      const href = $(el).attr("href");
      if (!href) return;
      if (searchTerms.some((term) => text.includes(term))) {
        found = this.resolve(href);
      }
    });
    return found;
  }

  private async get(url: string): Promise<ReturnType<typeof cheerio.load>> {
    const response = await this.client.get(url);
    return cheerio.load(response.data as string);
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    const loginPage = await this.client.get(LOGIN_URL);
    const $ = cheerio.load(loginPage.data as string);

    const formAction =
      $("form").first().attr("action") ?? LOGIN_URL;
    const actionUrl = this.resolve(formAction);

    const formData: Record<string, string> = {};
    $('input[type="hidden"]').each((_, el) => {
      const name = $(el).attr("name");
      const value = $(el).attr("value") ?? "";
      if (name) formData[name] = value;
    });
    formData["username"] = username;
    formData["password"] = password;
    formData["submit"] = "Anmelden";

    const response = await this.client.post(
      actionUrl,
      new URLSearchParams(formData).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: LOGIN_URL,
        },
      }
    );

    const html = response.data as string;
    if (
      html.includes("Falscher Benutzername") ||
      html.includes("falsche Kombination") ||
      html.includes("Anmeldung fehlgeschlagen")
    ) {
      throw new Error("Login fehlgeschlagen: Benutzername oder Passwort falsch.");
    }
    if (!html.includes("Abmelden") && !html.includes("Mein Studium")) {
      throw new Error("Login fehlgeschlagen: Unbekannter Fehler.");
    }
    console.log("Login erfolgreich.");
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async fetchGrades(): Promise<Grade[]> {
    // Schritt 1: Portal-Seite laden → "Mein Studium" finden
    console.log('Navigiere zu "Mein Studium"...');
    const $portal = await this.get(
      `${BASE_URL}/qisserver/rds?state=user&type=0`
    );
    const meinStudiumUrl = this.findLink($portal, "Mein Studium");
    if (!meinStudiumUrl) {
      throw new Error('"Mein Studium" Link nicht gefunden.');
    }

    // Schritt 2: "Mein Studium" → "Notenspiegel / Studienverlauf" finden
    console.log('Navigiere zu "Notenspiegel / Studienverlauf"...');
    const $meinStudium = await this.get(meinStudiumUrl);
    const notenspiegelUrl = this.findLink(
      $meinStudium,
      "Notenspiegel",
      "Studienverlauf"
    );
    if (!notenspiegelUrl) {
      throw new Error('"Notenspiegel / Studienverlauf" Link nicht gefunden.');
    }

    // Schritt 3: Notenspiegel-Seite → "Abschluss 82" ausklappen
    console.log('Klicke auf "Abschluss 82 Bachelor of Science"...');
    const $notenspiegel = await this.get(notenspiegelUrl);
    const abschlussUrl = this.findLink(
      $notenspiegel,
      "Abschluss 82",
      "Bachelor of Science"
    );
    if (!abschlussUrl) {
      throw new Error('"Abschluss 82 Bachelor of Science" Link nicht gefunden.');
    }

    // Schritt 4: Ausgeklappte Seite → Infobutton bei "Informatik (PO-Version 2017)"
    console.log('Suche Infobutton bei "Informatik (PO-Version 2017)"...');
    const $abschluss = await this.get(abschlussUrl);
    const infoUrl = this.findInfoButton($abschluss);
    if (!infoUrl) {
      throw new Error(
        'Infobutton für "Informatik (PO-Version 2017)" nicht gefunden.'
      );
    }

    // Schritt 5: Noten-Tabelle laden und parsen
    console.log(`Lade Notentabelle von: ${infoUrl.substring(0, 100)}...`);
    const gradesResponse = await this.client.get(infoUrl);
    const gradesHtml = gradesResponse.data as string;

    // Debug-Modus: HTML in Datei speichern
    if (process.argv.includes("--debug")) {
      const debugPath = path.join(process.cwd(), "debug_grades_list.html");
      fs.writeFileSync(debugPath, gradesHtml, "utf-8");
      console.log(`Debug-HTML gespeichert: ${debugPath}`);
    }

    const $grades = cheerio.load(gradesHtml);
    return this.parseGrades($grades);
  }

  /**
   * Findet den Infobutton neben "Informatik (PO-Version 2017)".
   * Der Infobutton hat immer "createInfos=Y" im href.
   */
  private findInfoButton($: ReturnType<typeof cheerio.load>): string | null {
    let found: string | null = null;

    // Direkt alle Links mit "createInfos=Y" suchen — das ist das verlässlichste Merkmal
    $("a[href*='createInfos=Y']").each((_, el) => {
      if (found) return;
      const href = $(el).attr("href");
      if (href) {
        // URL-Fragment entfernen (alles nach #), da es HTTP-Requests nicht betrifft
        found = this.resolve(href.split("#")[0]!);
        console.log(`Infobutton gefunden: ${found.substring(0, 100)}...`);
      }
    });

    if (found) return found;

    // Fallback: alle Links ausgeben (Debug-Hilfe)
    console.warn("Kein createInfos=Y Link gefunden. Alle Links auf der Seite:");
    $("a").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (href && !href.startsWith("javascript") && !href.startsWith("#")) {
        console.warn(`  "${text}" → ${href.substring(0, 120)}`);
      }
    });

    return null;
  }

  // ── Tabellen-Parser ────────────────────────────────────────────────────────

  private parseGrades($: ReturnType<typeof cheerio.load>): Grade[] {
    const grades: Grade[] = [];
    const debug = process.argv.includes("--debug");

    // Alle Tabellen auf der Seite analysieren
    $("table").each((tableIdx, table) => {
      // Spaltenköpfe aus <th> lesen
      const headers: string[] = [];
      $(table)
        .find("th")
        .each((_, th) => {
          headers.push($(th).text().trim().replace(/\s+/g, " "));
        });

      // Falls keine <th>, erste <tr> als Header versuchen
      if (headers.length === 0) {
        $(table)
          .find("tr")
          .first()
          .find("td")
          .each((_, td) => {
            headers.push($(td).text().trim().replace(/\s+/g, " "));
          });
      }

      if (debug || headers.length > 0) {
        console.log(
          `Tabelle ${tableIdx}: [${headers.map((h) => `"${h}"`).join(", ")}]`
        );
      }

      const headersLower = headers.map((h) => h.toLowerCase());

      const idxName = headersLower.findIndex(
        (h) =>
          h.includes("bezeichnung") ||
          h.includes("leistung") ||
          h.includes("modul") ||
          h.includes("prüfung") ||
          h.includes("fach")
      );
      const idxGrade = headersLower.findIndex(
        (h) =>
          h === "note" ||
          h.startsWith("note") ||
          h.includes("note") ||
          h === "ergebnis"
      );
      const idxPrfArt = headersLower.findIndex(
        (h) => h.includes("prf.art") || h.includes("prüfungsart") || h.includes("art")
      );
      const idxStatus = headersLower.findIndex((h) => h.includes("status"));

      if (idxName === -1 || idxGrade === -1) {
        if (debug) {
          console.log(
            `  → übersprungen (kein Name-Index: ${idxName}, kein Note-Index: ${idxGrade})`
          );
        }
        return;
      }

      console.log(
        `Notentabelle gefunden (Spalte ${idxName}="${headers[idxName]}", Spalte ${idxGrade}="${headers[idxGrade]}", Prf.Art-Spalte: ${idxPrfArt === -1 ? "nicht gefunden" : idxPrfArt})`
      );

      // Datenzellen lesen (ab Zeile 1, da Zeile 0 = Header)
      $(table)
        .find("tr")
        .each((rowIdx, row) => {
          if (rowIdx === 0) return;

          const cells: string[] = [];
          $(row)
            .find("td")
            .each((_, td) => {
              cells.push($(td).text().trim().replace(/\s+/g, " "));
            });

          if (cells.length < 2) return;

          const name = (cells[idxName] ?? "").trim();
          const grade = (cells[idxGrade] ?? "").trim();
          const prfArt = idxPrfArt !== -1 ? (cells[idxPrfArt] ?? "").trim() : "";
          const status = idxStatus !== -1 ? (cells[idxStatus] ?? "").trim() : "";

          if (!name) return;

          // Nur Prüfungsleistungen (PL) berücksichtigen
          if (idxPrfArt !== -1 && prfArt !== "PL") {
            if (debug) {
              console.log(`  Zeile ${rowIdx}: übersprungen (Prf.Art="${prfArt}", kein PL)`);
            }
            return;
          }

          if (debug) {
            console.log(`  Zeile ${rowIdx}: name="${name}" note="${grade}" prf.art="${prfArt}"`);
          }

          const id = name.toLowerCase().replace(/[^a-z0-9äöüß]/g, "_");

          grades.push({
            id,
            name,
            grade,
            status,
            semester: "",
            date: "",
            credits: "",
          });
        });
    });

    return grades;
  }
}
