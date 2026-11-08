import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';

/** Cross-cutting HTTP setup shared by the real server (main.ts) and the integration tests. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('StockFlow API')
    .setDescription(
      'Inventory and order management.\n\n' +
        'Errors share one shape: `{ statusCode, error, code, message, details?, path, timestamp }`. ' +
        '400 = invalid input, 404 = unknown resource, 409 = conflicts with current state ' +
        '(e.g. invalid status transition), 422 = refers to an ineligible resource (e.g. inactive agent).',
    )
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
