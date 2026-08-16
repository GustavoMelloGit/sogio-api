import { Resend } from "resend";
import type {
  EmailMessage,
  EmailService,
} from "../../application/email/email_service";

export class ResendEmailService implements EmailService {
  #client: Resend;
  #from: string;

  constructor(apiKey: string, from: string) {
    this.#client = new Resend(apiKey);
    this.#from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    const result = await this.#client.emails.send({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }
  }
}
