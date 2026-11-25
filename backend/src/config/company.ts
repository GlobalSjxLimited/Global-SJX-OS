/** Letterhead / tax details printed on invoices. Override any of these in .env; defaults are the Global SJX details from the legacy invoice template. */
const e = (k: string, d: string) => process.env[k] || d;
export const company = {
  name: e('COMPANY_NAME', 'Global SJX Limited'),
  address: e('COMPANY_ADDRESS', 'Block 3, Plot 57b, Fatai Idowu Arobieke Street, Lekki Phase 1, Lagos'),
  email: e('COMPANY_EMAIL', 'talk2us@globalsjxltd.com'),
  website: e('COMPANY_WEBSITE', 'www.globalsjxltd.com'),
  rc: e('COMPANY_RC', '918111'),
  vatNumber: e('COMPANY_VAT_NUMBER', '10582697-0001'),
  taxId: e('COMPANY_TAX_ID', '2522513167388'),
  directors: e('COMPANY_DIRECTORS', 'Sina Joseph MD/CEO (Nigerian) · Folukemi Joseph (Nigerian) · Omeiza Abuno (Nigerian)'),
  receiptEmail: e('INVOICE_RECEIPT_EMAIL', 'sina.joseph@globalsjxltd.com'),
};
