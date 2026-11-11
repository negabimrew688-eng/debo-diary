import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/AppError.js';

fs.mkdirSync(path.resolve(env.uploadDir), { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: path.resolve(env.uploadDir),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPEG, PNG or WebP images are allowed')),
});
