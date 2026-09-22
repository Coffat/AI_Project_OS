export interface Invoice {
  id: string;
  amountCents: number;
  customerId: string;
  status: 'draft' | 'paid' | 'void';
}

export class InvoiceService {
  public async createInvoice(customerId: string, amountCents: number): Promise<Invoice> {
    return {
      id: `inv_${Date.now()}`,
      amountCents,
      customerId,
      status: 'draft',
    };
  }

  public async chargeCustomer(_invoiceId: string): Promise<boolean> {
    // Isolated billing payment processing
    return true;
  }
}
