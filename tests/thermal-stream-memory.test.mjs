import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('streams 773k rows within a 96 MiB V8 heap and caps stored transition summaries', { timeout: 90_000 }, () => {
  const child = spawnSync(process.execPath, [
    '--max-old-space-size=96',
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    path.join(root, 'tests/fixtures/thermal-stream-memory-child.mjs')
  ], { encoding: 'utf8', timeout: 85_000, maxBuffer: 1024 * 1024 })
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.status, 0, child.stderr || child.stdout)
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1))
  assert.equal(result.sampleCount, 773_071)
  assert.equal(result.storedResponses, 10_000)
  assert.ok(result.totalResponses > result.storedResponses)
  assert.ok(result.heapUsedMB < 96)
})
