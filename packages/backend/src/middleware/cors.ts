import cors from 'cors';
import { config } from '../config/aws.js';

const isProduction = process.env.NODE_ENV === 'production';

export const corsMiddleware = cors({
  origin: isProduction
    ? config.frontendUrl  // Restrict to FRONTEND_URL in production
    : true,               // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // Cache preflight for 24h
});
