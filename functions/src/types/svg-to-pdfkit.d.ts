declare module "svg-to-pdfkit" {
  import PDFDocument from "pdfkit";

  type SvgToPdfOptions = {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
  };

  export default function SVGtoPDF(
    doc: PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: SvgToPdfOptions
  ): void;
}
