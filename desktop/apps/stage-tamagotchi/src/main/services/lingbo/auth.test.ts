import type { ElectronMainContextExtensions, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, IpcMainEvent } from 'electron'

import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'

import { createContext, defineInvoke } from '@moeru/eventa'
import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { electronAuthCallback, electronAuthCallbackError, electronAuthComplete, electronAuthGetStatus, electronAuthLogout, electronAuthStartLogin } from '../../../shared/eventa'
import { createAuthService } from './auth'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))

describe('electron login request ownership', () => {
  const cleanups: Array<() => Promise<void>> = []
  const networkFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_ACCOUNT_LOGIN', 'true')
  })

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0))
      await cleanup()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined)
  })

  function windowLogin(id: number) {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const window = Object.assign(new EventEmitter(), { webContents: { id }, isDestroyed: () => false }) as BrowserWindow
    createAuthService({ context, window })
    const options = { raw: { ipcMainEvent: { sender: { id } } as IpcMainEvent, event: undefined } }
    const start = defineInvoke(context, electronAuthStartLogin)
    const logout = defineInvoke(context, electronAuthLogout)
    const getStatus = defineInvoke(context, electronAuthGetStatus)
    const complete = defineInvoke(context, electronAuthComplete)
    const received = vi.fn()
    context.on(electronAuthCallback, received)
    const failed = vi.fn()
    context.on(electronAuthCallbackError, failed)
    cleanups.push(async () => {
      await logout(undefined, options)
    })
    return {
      start: () => start(undefined, options),
      logout: () => logout(undefined, options),
      getStatus: () => getStatus(undefined, options),
      complete: (result: { attemptId: string, error?: string }) => complete(result, options),
      received,
      failed,
      window,
    }
  }

  async function callback(index: number) {
    const authorization = new URL(vi.mocked(shell.openExternal).mock.calls[index]![0])
    const [port, state] = authorization.searchParams.get('state')!.split(':')
    const response = await networkFetch(`http://127.0.0.1:${port}/callback?code=test-code&state=${state}`)
    expect(response.ok).toBe(true)
  }

  it('never opens a browser when account login is not enabled in the local build', async () => {
    vi.stubEnv('VITE_ENABLE_ACCOUNT_LOGIN', undefined)
    const login = windowLogin(100)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await Promise.all(Array.from({ length: 25 }, () => login.start()))
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await login.getStatus())?.state).toBe('error')
    expect((await login.getStatus())?.error).toContain('未启用账号登录服务')
    expect(login.received).not.toHaveBeenCalled()
  })

  it('opens one browser for repeated requests while the same window is signing in', async () => {
    const login = windowLogin(101)
    await login.start()
    const status = await login.getStatus()
    await Promise.all(Array.from({ length: 25 }, () => login.start()))
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect((await login.getStatus())?.attemptId).toBe(status?.attemptId)
  })

  // ROOT CAUSE:
  // Closing the loopback does not cancel a token exchange that already started.
  // Only the current login attempt can publish tokens or clear the active attempt.
  it('discards a token exchange after another window starts a new login', async () => {
    const exchange = Promise.withResolvers<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(exchange.promise)
    const first = windowLogin(1)
    const second = windowLogin(2)
    await first.start()
    await callback(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await second.start()
    exchange.resolve(Response.json({ access_token: 'discarded', expires_in: 3600 }))
    // Drain the response body and background completion microtasks.
    await setImmediate()
    expect(first.received).not.toHaveBeenCalled()
    // The old completion must not remove the new loopback's cleanup handle.
    await second.logout()
    const url = new URL(vi.mocked(shell.openExternal).mock.calls[1]![0])
    const port = url.searchParams.get('state')!.split(':')[0]
    await vi.waitFor(async () => {
      await expect(networkFetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow()
    })
  })

  it('publishes only the new login result after replacement', async () => {
    const first = windowLogin(5)
    const second = windowLogin(6)
    await first.start()
    await second.start()
    // Closing the old owner must not cancel the new owner's attempt.
    first.window.emit('closed')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ access_token: 'current', expires_in: 3600 }))
    await callback(1)
    await vi.waitFor(() => expect(second.received).toHaveBeenCalledTimes(1))
    expect(first.received).not.toHaveBeenCalled()
    expect(second.received.mock.calls[0]![0].body.accessToken).toBe('current')
  })

  it('keeps confirmation open until the renderer reports completion', async () => {
    const login = windowLogin(10)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ access_token: 'current', expires_in: 3600 }))
    await login.start()
    await callback(0)
    await vi.waitFor(() => expect(login.received).toHaveBeenCalledTimes(1))
    const attemptId = login.received.mock.calls[0]![0].body.attemptId as string
    await setImmediate()
    expect((await login.getStatus())?.state).toBe('confirming')
    await login.complete({ attemptId })
    expect((await login.getStatus())?.state).toBe('success')
  })

  it('ignores completion from a replaced login', async () => {
    const first = windowLogin(11)
    const second = windowLogin(12)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ access_token: 'current', expires_in: 3600 }))
    await first.start()
    await callback(0)
    await vi.waitFor(() => expect(first.received).toHaveBeenCalledTimes(1))
    const oldAttemptId = first.received.mock.calls[0]![0].body.attemptId as string
    await second.start()
    await first.complete({ attemptId: oldAttemptId })
    expect((await second.getStatus())?.state).toBe('waiting')
  })

  // ROOT CAUSE:
  // The lifecycle mutex was released before the listener became ready. An immediate
  // browser failure could close a server that had not started listening yet.
  // Waiting for readiness inside start keeps cancellation ordered after startup.
  it('reports browser launch failure once and closes its callback server', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('browser unavailable'))
    const login = windowLogin(9)
    await login.start()
    await setImmediate()
    expect(login.failed).toHaveBeenCalledTimes(1)
    expect(login.received).not.toHaveBeenCalled()
    const url = new URL(vi.mocked(shell.openExternal).mock.calls[0]![0])
    const port = url.searchParams.get('state')!.split(':')[0]
    await vi.waitFor(async () => {
      await expect(networkFetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow()
    })
  })

  it('keeps only the latest attempt during concurrent startup', async () => {
    const first = windowLogin(7)
    const second = windowLogin(8)
    await Promise.all([first.start(), second.start()])
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('discards a token exchange after logout', async () => {
    const exchange = Promise.withResolvers<Response>()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(exchange.promise)
    const login = windowLogin(3)
    await login.start()
    await callback(0)
    await login.logout()
    exchange.resolve(Response.json({ access_token: 'discarded', expires_in: 3600 }))
    await setImmediate()
    expect(login.received).not.toHaveBeenCalled()
  })

  it('discards a token exchange after its window closes', async () => {
    const exchange = Promise.withResolvers<Response>()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(exchange.promise)
    const login = windowLogin(4)
    await login.start()
    await callback(0)
    login.window.emit('closed')
    exchange.resolve(Response.json({ access_token: 'discarded', expires_in: 3600 }))
    await setImmediate()
    expect(login.received).not.toHaveBeenCalled()
  })
})
