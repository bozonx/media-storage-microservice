const THUMBNAIL_MIN_SIZE = 10;

export default () => ({
  thumbnail: {
    format: (process.env.THUMBNAIL_FORMAT || 'webp') as 'webp' | 'avif',
    maxWidth: parseInt(process.env.THUMBNAIL_MAX_WIDTH || '2048', 10),
    maxHeight: parseInt(process.env.THUMBNAIL_MAX_HEIGHT || '2048', 10),
    minWidth: THUMBNAIL_MIN_SIZE,
    minHeight: THUMBNAIL_MIN_SIZE,
    cacheMaxAgeSeconds:
      parseInt(process.env.THUMBNAIL_CACHE_MAX_AGE_DAYS || '365', 10) * 24 * 60 * 60,
    quality: parseInt(process.env.THUMBNAIL_QUALITY || '80', 10),
    effort: parseInt(process.env.THUMBNAIL_EFFORT || '6', 10),
  },
});
