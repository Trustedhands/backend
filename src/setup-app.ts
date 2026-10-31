import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DomainExceptionFilter } from './shared/http/domain-exception.filter.js';

/** Shared by main.ts and e2e tests so both run the same pipeline. */
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
}

export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('TrustedHands API')
      .setDescription('API for the TrustedHands client PWA and admin console')
      .setVersion('1')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Supabase access token',
      })
      .build(),
  );
}
