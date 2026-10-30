import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { gh } from '../hooks/register'

test('gh probiert die anderen Pfade, wenn der gemerkte nicht mehr startet', async () => {
  let pathHatGh = true
  const gestartet: string[] = []
  const run = async (argv: readonly string[]) => {
    const pfad = argv[0]
    gestartet.push(pfad)
    if (pfad === 'gh' && !pathHatGh) {
      throw new Error("$.process.run(gh) failed to start: ENOENT: no such file or directory, posix_spawn 'gh'")
    }
    if (pfad === '/opt/homebrew/bin/gh') throw new Error('ENOENT')
    return { exitCode: 0, stdout: pfad, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  const $ = { process: { run } } as unknown as EngineInterface

  expect(await gh($, ['--version'])).toBe('gh')
  pathHatGh = false
  expect(await gh($, ['--version'])).toBe('/usr/local/bin/gh')
  expect(await gh($, ['--version'])).toBe('/usr/local/bin/gh')
  expect(gestartet).toEqual(['gh', 'gh', '/usr/local/bin/gh', '/usr/local/bin/gh'])
})
