import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeModule } from './stripe.module';
import { StripeSeedService } from './stripe-seed.service';

@Module({
  imports: [ConfigModule.forRoot(), StripeModule],
})
class SeedAppModule {}

async function run() {
  const app = await NestFactory.createApplicationContext(SeedAppModule);
  const seeder = app.get(StripeSeedService);

  try {
    const result = await seeder.seed();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Stripe seed failed:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run();
