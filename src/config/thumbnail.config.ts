const THUMBNAIL_MIN_SIZE = 10;

export default () => ({
  thumbnail: {
    enabled: process.env.THUMBNAIL_ENABLED === 'true',
    defaultQuality: parseInt(process.env.THUMBNAIL_DEFAULT_QUALITY || '80', 10),
    maxWidth: parseInt(process.env.THUMBNAIL_MAX_WIDTH || '2048', 10),
    maxHeight: parseInt(process.env.THUMBNAIL_MAX_HEIGHT || '2048', 10),
    minWidth: THUMBNAIL_MIN_SIZE,
    minHeight: THUMBNAIL_MIN_SIZE,
    cacheMaxAge: parseInt(process.env.THUMBNAIL_CACHE_MAX_AGE || '31536000', 10),
  },
});
