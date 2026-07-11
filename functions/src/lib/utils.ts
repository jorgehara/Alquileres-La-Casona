export function nowIso(): string {
  return new Date().toISOString();
}

export function monthPeriod(date = new Date(), offsetMonths = 0): string {
  const shifted = new Date(date.getFullYear(), date.getMonth() + offsetMonths, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function rentalPeriod(date = new Date()): string {
  return monthPeriod(date, -1);
}

export function collectionPeriod(date = new Date()): string {
  return monthPeriod(date, 0);
}

export function sumAmounts(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

export function randomToken(length = 48): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";

  for (let index = 0; index < length; index += 1) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }

  return output;
}
