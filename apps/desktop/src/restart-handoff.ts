/** Restart handoff recorded by the Electron shell for the Host it is about to respawn. */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Environment variable carrying the restart identity into the respawned Host. */
export const DESKTOP_RESTART_ID_ENV = 'DSH_DESKTOP_RESTART_ID'

/**
 * Environment variable advertising that this shell accepts a Host restart request.
 *
 * A plugin decides whether to hand the restart to the shell by reading this value, not
 * by inspecting argv or a profile name: those describe how the process was launched,
 * not which lifecycle protocol the shell actually speaks.
 */
export const DESKTOP_RESTART_PROTOCOL_ENV = 'DSH_DESKTOP_RESTART_PROTOCOL'

/** Protocol generation advertised through {@link DESKTOP_RESTART_PROTOCOL_ENV}. */
export const DESKTOP_RESTART_PROTOCOL_VERSION = 1

/** Handoff record; written by the shell before it relaunches and consumed by the next start. */
interface RestartHandoffRecord {
  readonly schemaVersion: 1
  readonly restartId: string
  readonly requestedAt: string
  /** The shell process that recorded it; a record from another pid is residue. */
  readonly pid: number
}

/** @param userData - the application's userData directory, which survives `app.relaunch()`. */
export function restartHandoffPath(userData: string): string {
  return join(userData, 'restart-handoff.json')
}

/**
 * Record the restart this shell is about to perform.
 *
 * The relaunched shell has no memory of the request, and `app.relaunch()` carries no
 * arguments or environment, so the identity has to survive on disk. A write failure is
 * fatal to the restart: the successor would otherwise come up unable to prove it is the
 * process this request produced.
 * @param path - {@link restartHandoffPath} of the running installation.
 * @param restartId - identity the requester assigned to this restart.
 * @param now - clock reading recorded with the request.
 */
export function writeRestartHandoff(path: string, restartId: string, now: Date = new Date()): void {
  const record: RestartHandoffRecord = {
    schemaVersion: 1,
    restartId,
    requestedAt: now.toISOString(),
    pid: process.pid,
  }
  writeFileSync(path, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
}

/**
 * Take the recorded restart identity, if any, and remove the record.
 *
 * One-shot by construction: the record is deleted before it is returned, so a later
 * ordinary launch cannot claim a restart it did not perform.
 * @param path - {@link restartHandoffPath} of the running installation.
 * @param now - clock reading; a record older than an hour is residue from a launch that never happened.
 * @returns the restartId the previous shell recorded, or undefined.
 */
export function consumeRestartHandoff(path: string, now: Date = new Date()): string | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  try { rmSync(path, { force: true }) } catch { /* the launch proceeds either way */ }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || !('restartId' in parsed)) return undefined
  const record = parsed as Partial<RestartHandoffRecord>
  if (record.schemaVersion !== 1 || typeof record.restartId !== 'string' || record.restartId.length === 0) return undefined
  if (typeof record.requestedAt !== 'string') return undefined
  const age = now.getTime() - Date.parse(record.requestedAt)
  if (!Number.isFinite(age) || age > 60 * 60 * 1000) return undefined
  return record.restartId
}
