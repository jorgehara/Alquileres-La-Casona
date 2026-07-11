declare module "qrcode" {
  type QrOptions = {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    width?: number;
    margin?: number;
  };

  export function toBuffer(text: string, options?: QrOptions): Promise<Buffer>;
}
