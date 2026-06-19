import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'actions/stripe': 'src/actions/stripe.ts',
    'webhooks/handler': 'src/webhooks/handler.ts',
    'scripts/backfill': 'src/scripts/backfill.ts',
    'types': 'src/types.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['stripe', '@supabase/supabase-js', '@supabase/ssr', 'next'],
})
