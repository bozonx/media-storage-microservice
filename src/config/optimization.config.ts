import { registerAs } from '@nestjs/config';

export interface OptimizationConfig {
  enabled: boolean;
  defaultQuality: number;
  maxWidth: number;
  maxHeight: number;
}

export default registerAs(
  'optimization',
  (): OptimizationConfig => ({
    enabled: process.env.IMAGE_OPTIMIZATION_ENABLED !== 'false',
    defaultQuality: parseInt(process.env.IMAGE_OPTIMIZATION_DEFAULT_QUALITY || '85', 10),
    maxWidth: parseInt(process.env.IMAGE_OPTIMIZATION_MAX_WIDTH || '3840', 10),
    maxHeight: parseInt(process.env.IMAGE_OPTIMIZATION_MAX_HEIGHT || '2160', 10),
  }),
);
