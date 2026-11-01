/** Restart handoff between the Electron shell and the Host it respawns. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumeRestartHandoff, restartHandoffPath, writeRestartHandoff } from '../src/restart-handoff.ts'

describe('restart handoff', () => {
  let userData: string
  let path: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'dsh-restart-handoff-'))
    path = restartHandoffPath(userData)
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('carries the identity across the relaunch and is taken exactly once', () => {
    // `app.relaunch()` passes neither arguments nor environment, so the identity is
    // the only thing that can span the two shell processes.
    writeRestartHandoff(path, 'restart-1', new Date('2026-11-01T00:00:00.000Z'))
    expect(consumeRestartHandoff(path, new Date('2026-11-01T00:00:05.000Z'))).toBe('restart-1')
    // Consumed: an ordinary launch afterwards must not claim a restart it did not perform.
    expect(consumeRestartHandoff(path, new Date('2026-11-01T00:00:06.000Z'))).toBeUndefined()
  })

  it('reports no handoff for a first launch', () => {
    expect(consumeRestartHandoff(path)).toBeUndefined()
  })

  it('ignores a record from a launch that never happened', () => {
    // A crash between the write and the exit leaves the file behind; an hour later it
    // describes nothing current, so the next start must read it as absent.
    writeRestartHandoff(path, 'stale', new Date('2026-11-01T00:00:00.000Z'))
    expect(consumeRestartHandoff(path, new Date('2026-11-01T02:00:00.000Z'))).toBeUndefined()
  })

  it('ignores a malformed or foreign record', () => {
    writeFileSync(path, 'not json', 'utf8')
    expect(consumeRestartHandoff(path)).toBeUndefined()

    writeFileSync(path, JSON.stringify({ schemaVersion: 2, restartId: 'v2', requestedAt: new Date().toISOString() }), 'utf8')
    expect(consumeRestartHandoff(path)).toBeUndefined()

    writeFileSync(path, JSON.stringify({ schemaVersion: 1, restartId: '', requestedAt: new Date().toISOString() }), 'utf8')
    expect(consumeRestartHandoff(path)).toBeUndefined()

    writeFileSync(path, JSON.stringify({ schemaVersion: 1, restartId: 'no-time' }), 'utf8')
    expect(consumeRestartHandoff(path)).toBeUndefined()
  })

  it('survives an unwritable record path by reporting it to the caller', () => {
    // The caller must not relaunch on a failed write: the successor would come up
    // unable to prove it is this request's.
    expect(() => writeRestartHandoff(join(userData, 'missing', 'handoff.json'), 'x')).toThrow()
  })
})
