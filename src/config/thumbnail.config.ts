const THUMBNAIL_MIN_SIZE = 10;

export default () => ({
  thumbnail: {
    enabled: process.env.THUMBNAIL_ENABLED === 'true',
    format: (process.env.THUMBNAIL_FORMAT || 'webp') as 'webp' | 'avif',
    maxWidth: parseInt(process.env.THUMBNAIL_MAX_WIDTH || '2048', 10),
    maxHeight: parseInt(process.env.THUMBNAIL_MAX_HEIGHT || '2048', 10),
    minWidth: THUMBNAIL_MIN_SIZE,
    minHeight: THUMBNAIL_MIN_SIZE,
    cacheMaxAge: parseInt(process.env.THUMBNAIL_CACHE_MAX_AGE || '31536000', 10),
    webp: {
      quality: parseInt(process.env.THUMBNAIL_WEBP_QUALITY || '80', 10),
      effort: parseInt(process.env.THUMBNAIL_WEBP_EFFORT || '6', 10),
    },
    avif: {
      quality: parseInt(process.env.THUMBNAIL_AVIF_QUALITY || '60', 10),
      effort: parseInt(process.env.THUMBNAIL_AVIF_EFFORT || '6', 10),
    },
  },
});
