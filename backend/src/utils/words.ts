const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; if (n) parts.push('and'); }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

export function integerToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'Zero';
  const chunks: string[] = [];
  let i = 0;
  while (n > 0 && i < SCALES.length) {
    const c = n % 1000;
    if (c) chunks.unshift(`${below1000(c)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
    n = Math.floor(n / 1000); i++;
  }
  return chunks.join(', ').replace(/^and /, '');
}

const UNITS: Record<string, [string, string]> = {
  NGN: ['Naira', 'Kobo'], USD: ['United States Dollars', 'Cents'], GBP: ['Pounds Sterling', 'Pence'], EUR: ['Euros', 'Cents'],
};

/** 1250.5 USD → "One Thousand, Two Hundred and Fifty United States Dollars and Fifty Cents Only" */
export function amountInWords(amount: number, currency = 'NGN'): string {
  const [major, minor] = UNITS[currency] || [currency, 'Cents'];
  const cents = Math.round((Math.abs(amount || 0) + Number.EPSILON) * 100);
  const whole = Math.floor(cents / 100), frac = cents % 100;
  return `${integerToWords(whole)} ${major}${frac ? ` and ${integerToWords(frac)} ${minor}` : ''} Only`;
}
