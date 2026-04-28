import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

const REQUIRED_ENV = ['JWT_SECRET', 'INTERNAL_API_KEY', 'DATABASE_URL'];

function assertEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`FATAL: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function bootstrap() {
  assertEnv();

  // Item 15: disable built-in body parser to enforce size limit ourselves
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Capture raw body before JSON parsing — needed for webhook HMAC verification
  app.use(
    json({
      limit: '10kb',
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10kb' }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Item 16: explicit origin list from env — no wildcard, fail-closed if unset
  const rawOrigins = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}

bootstrap();
