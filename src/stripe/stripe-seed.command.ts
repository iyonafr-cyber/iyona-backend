import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { StripeSeedService } from './stripe-seed.service';

// Minimal module: the seeder only needs StripeService (no Auth/User/DB),
// so we avoid importing the full StripeModule and its module graph.
@Module({
  imports: [ConfigModule.forRoot()],
  providers: [StripeService, StripeSeedService],
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
