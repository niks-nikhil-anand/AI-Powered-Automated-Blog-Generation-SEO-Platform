export type GeneratedImage = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  /** Which procedural layout rendered this - only set by the SVG fallback generator, see generator.ts. */
  layout?: string;
};

export type UploadedImage = {
  bucket: string;
  key: string;
  publicUrl: string;
  size: number;
};
