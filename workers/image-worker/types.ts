export type GeneratedImage = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
};

export type UploadedImage = {
  bucket: string;
  key: string;
  publicUrl: string;
  size: number;
};
