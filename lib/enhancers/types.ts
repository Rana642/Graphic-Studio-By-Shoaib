export type UpscaleInput = {
  imageBuffer: Buffer;
  mimeType: string;
  outputWidth: number;
  outputHeight: number;
};

export type UpscaleResult = {
  imageBuffer: Buffer;
  mimeType: string;
  estCostUsd: number;
};
