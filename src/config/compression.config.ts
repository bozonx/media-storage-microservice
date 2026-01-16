export default () => ({
  compression: {
    forceEnabled: process.env.FORCE_IMAGE_COMPRESSION_ENABLED === 'true',
    defaultFormat: (process.env.IMAGE_COMPRESSION_DEFAULT_FORMAT || 'webp') as 'webp' | 'avif',
    maxWidth: parseInt(process.env.IMAGE_COMPRESSION_MAX_WIDTH || '3840', 10),
    maxHeight: parseInt(process.env.IMAGE_COMPRESSION_MAX_HEIGHT || '2160', 10),
    stripMetadataDefault: process.env.IMAGE_COMPRESSION_STRIP_METADATA_DEFAULT === 'true',
    losslessDefault: process.env.IMAGE_COMPRESSION_LOSSLESS_DEFAULT === 'true',
    webp: {
      quality: parseInt(process.env.IMAGE_COMPRESSION_WEBP_QUALITY || '80', 10),
      effort: parseInt(process.env.IMAGE_COMPRESSION_WEBP_EFFORT || '6', 10),
    },
    avif: {
      quality: parseInt(process.env.IMAGE_COMPRESSION_AVIF_QUALITY || '60', 10),
      effort: parseInt(process.env.IMAGE_COMPRESSION_AVIF_EFFORT || '6', 10),
      chromaSubsampling: (process.env.IMAGE_COMPRESSION_AVIF_CHROMA_SUBSAMPLING || '4:4:4') as
        | '4:2:0'
        | '4:4:4',
    },
  },
});
