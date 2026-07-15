// Asserts the packed tarball actually contains what consumers need:
// every declared export target (+ its .d.ts), the shipped migration, and
// the docs referenced from npmjs.com / node_modules (README, LICENSE,
// CLAUDE.md, SKILL.md — see CLAUDE.md's own "automated setup skill" section,
// which tells Claude Code to read SKILL.md straight out of node_modules).
//
// Usage: node scripts/release/verify-tarball-contents.mjs <extracted-package-dir>
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pkgDir = process.argv[2]
if (!pkgDir) {
  console.error('Usage: node verify-tarball-contents.mjs <extracted-package-dir>')
  process.exit(1)
}

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

const pkgJsonPath = join(pkgDir, 'package.json')
if (!existsSync(pkgJsonPath)) {
  console.error('FAIL: package.json missing from tarball')
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))

// ─── Every declared export target must exist, alongside its .d.ts ─────────────
for (const [subpath, targets] of Object.entries(pkg.exports ?? {})) {
  for (const [condition, relPath] of Object.entries(targets)) {
    const abs = join(pkgDir, relPath)
    if (!existsSync(abs)) {
      fail(`exports["${subpath}"].${condition} → ${relPath} does not exist in tarball`)
      continue
    }
    if (condition === 'import' || condition === 'require') {
      const dtsPath = abs.replace(/\.(js|cjs)$/, condition === 'require' ? '.d.cts' : '.d.ts')
      if (!existsSync(dtsPath)) {
        fail(`exports["${subpath}"].${condition} → ${relPath} has no matching declaration file (expected ${dtsPath.replace(pkgDir + '/', '')})`)
      }
    }
  }
}

// ─── Migration must ship in the package ────────────────────────────────────────
const migrationsDir = join(pkgDir, 'supabase', 'migrations')
if (!existsSync(migrationsDir)) {
  fail('supabase/migrations/ is missing from the tarball — consumers would depend on copied documentation SQL instead of the canonical migration')
} else {
  const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  if (sqlFiles.length === 0) fail('supabase/migrations/ is present but contains no .sql files')
}

// ─── Docs referenced from README / CLAUDE.md / the setup skill ────────────────
for (const doc of ['README.md', 'LICENSE', 'CLAUDE.md', 'SKILL.md']) {
  if (!existsSync(join(pkgDir, doc))) fail(`${doc} is missing from the tarball`)
}

if (process.exitCode) {
  console.error('\nTarball content assertion failed.')
  process.exit(1)
}
console.log('Tarball contents OK.')
