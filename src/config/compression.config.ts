export default () => ({
  compression: {
    forceEnabled: process.env.FORCE_IMAGE_COMPRESSION_ENABLED === 'true',
    defaultQuality: parseInt(process.env.IMAGE_COMPRESSION_DEFAULT_QUALITY || '85', 10),
    maxWidth: parseInt(process.env.IMAGE_COMPRESSION_MAX_WIDTH || '3840', 10),
    maxHeight: parseInt(process.env.IMAGE_COMPRESSION_MAX_HEIGHT || '2160', 10),
    defaultFormat: (process.env.IMAGE_COMPRESSION_DEFAULT_FORMAT || 'webp') as 'webp' | 'avif',
  },
});
