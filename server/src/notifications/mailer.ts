import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { logger } from "../logger.js";

const log = logger.child({ mod: "mailer" });

export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

let transport: Transporter | undefined;

export function emailEnabled(): boolean {
  return config.smtp !== undefined;
}

// Never throws: an SMTP outage must not break a move, a challenge or a login.
// Returns whether the server accepted the message.
export async function sendMail(mail: Mail): Promise<boolean> {
  const smtp = config.smtp;
  if (!smtp) return false;
  try {
    transport ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({ from: smtp.from, ...mail });
    return true;
  } catch (err) {
    log.warn({ err }, "email failed to send");
    return false;
  }
}