export default () => ({
  compression: {
    forceEnabled: process.env.FORCE_IMAGE_COMPRESSION_ENABLED === 'true',
    format: (process.env.IMAGE_COMPRESSION_FORMAT || 'webp') as 'webp' | 'avif',
    maxDimension: parseInt(process.env.IMAGE_COMPRESSION_MAX_DIMENSION || '3840', 10),
    stripMetadata: process.env.IMAGE_COMPRESSION_STRIP_METADATA === 'true',
    lossless: process.env.IMAGE_COMPRESSION_LOSSLESS === 'true',
    autoOrient: process.env.IMAGE_COMPRESSION_AUTO_ORIENT !== 'false', // Default to true
    webp: {
      quality: parseInt(process.env.IMAGE_COMPRESSION_QUALITY || '80', 10),
      effort: parseInt(process.env.IMAGE_COMPRESSION_EFFORT || '6', 10),
    },
    avif: {
      quality: parseInt(process.env.IMAGE_COMPRESSION_QUALITY || '80', 10),
      effort: parseInt(process.env.IMAGE_COMPRESSION_EFFORT || '6', 10),
      chromaSubsampling: process.env.IMAGE_COMPRESSION_AVIF_CHROMA_SUBSAMPLING as
        | '4:2:0'
        | '4:4:4'
        | undefined,
    },
  },
});
