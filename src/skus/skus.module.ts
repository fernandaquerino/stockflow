import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { SkusController } from './skus.controller';
import { SkusRepository } from './skus.repository';
import { SkusService } from './skus.service';

@Module({
  imports: [ProductsModule],
  controllers: [SkusController],
  providers: [SkusService, SkusRepository],
  exports: [SkusRepository],
})
export class SkusModule {}
