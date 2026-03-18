import cors from 'cors';
import { config } from '../config/aws.js';

export const corsMiddleware = cors({
  origin: config.frontendUrl,
  credentials: true,
});
