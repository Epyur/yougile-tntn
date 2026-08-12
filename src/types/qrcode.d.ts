declare module 'qrcode' {
  export interface QRCodeOptions {
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
    [key: string]: unknown;
  }

  export function toCanvas(canvas: HTMLCanvasElement, text: string, options?: QRCodeOptions): Promise<unknown>;
  export function toDataURL(text: string, options?: QRCodeOptions): Promise<string>;

  const qrcode: {
    toCanvas: typeof toCanvas;
    toDataURL: typeof toDataURL;
  };

  export default qrcode;
}
