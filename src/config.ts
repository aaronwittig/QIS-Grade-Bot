import * as dotenv from "dotenv";
import { Config } from "./types";

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Fehlende Umgebungsvariable: ${key}\nBitte .env-Datei anlegen (siehe .env.example)`
    );
  }
  return value;
}

export function loadConfig(): Config {
  return {
    username: requireEnv("QIS_USERNAME"),
    password: requireEnv("QIS_PASSWORD"),
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegramChatId: requireEnv("TELEGRAM_CHAT_ID"),
    checkIntervalMinutes: parseInt(
      process.env["CHECK_INTERVAL_MINUTES"] ?? "60",
      10
    ),
  };
}
