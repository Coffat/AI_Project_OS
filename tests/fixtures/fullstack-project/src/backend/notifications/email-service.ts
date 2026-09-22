export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export class EmailService {
  public async sendEmail(_message: EmailMessage): Promise<{ sent: boolean }> {
    // Decoupled notification dispatch
    return { sent: true };
  }
}
