import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { SupabaseSchemaService } from './supabase-schema.service';
import { SupabasePostgresService } from './supabase-postgres.service';

@Module({
  providers: [
    SupabaseService,
    SupabaseSchemaService,
    SupabasePostgresService,
    { provide: 'ISupabaseService', useExisting: SupabaseService },
  ],
  exports: [
    SupabaseService,
    SupabaseSchemaService,
    SupabasePostgresService,
    'ISupabaseService',
  ],
})
export class SupabaseModule {}
