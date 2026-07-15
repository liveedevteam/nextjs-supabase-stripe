// Imports every public entry point from the installed tarball via ESM.
//
// nextjs-supabase-stripe/actions is deliberately excluded: it imports
// 'next/headers' and 'next/navigation', which Next.js's own package.json
// `exports` map only resolves correctly through Next's bundler (webpack/
// turbopack), not plain Node module resolution — `node` fails to resolve
// 'next/headers' even with `next` installed as a real dependency. That
// entry point is verified instead by the demo-build-against-tarball step,
// which goes through Next's actual resolver.
const entries = ['webhooks', 'types', 'testing']
let failed = false

for (const entry of entries) {
  try {
    const mod = await import(`nextjs-supabase-stripe/${entry}`)
    console.log(`OK  (ESM) nextjs-supabase-stripe/${entry} — exports: ${Object.keys(mod).join(', ')}`)
  } catch (err) {
    failed = true
    console.error(`FAIL (ESM) nextjs-supabase-stripe/${entry}:`, err.message)
  }
}

process.exit(failed ? 1 : 0)
