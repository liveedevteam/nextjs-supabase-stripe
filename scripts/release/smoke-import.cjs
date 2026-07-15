// CJS counterpart of smoke-import.mjs — see that file for why
// nextjs-supabase-stripe/actions is excluded.
const entries = ['webhooks', 'types', 'testing']
let failed = false

for (const entry of entries) {
  try {
    const mod = require(`nextjs-supabase-stripe/${entry}`)
    console.log(`OK  (CJS) nextjs-supabase-stripe/${entry} — exports: ${Object.keys(mod).join(', ')}`)
  } catch (err) {
    failed = true
    console.error(`FAIL (CJS) nextjs-supabase-stripe/${entry}:`, err.message)
  }
}

process.exit(failed ? 1 : 0)
