import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { buildOpenApiDocument, setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Behind a load balancer, rate limits must see the client's IP, not the proxy's
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  setupApp(app);
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    // The refresh token travels as an httpOnly cookie
    credentials: true,
  });
  app.enableShutdownHooks();
  // The spec feeds the frontend's generated client; no need to publish it in production
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
