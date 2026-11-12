import type { BrowserWindow } from 'electron'

import { shell } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { protectPrivilegedWindowNavigation, resizeBoundsByDelta, setWindowAlwaysOnTop } from './window'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(shell.openExternal).mockClear()
})

describe('local account navigation guard', () => {
  it('blocks repeated local authorization navigations and popups without blocking normal web links', () => {
    vi.stubEnv('VITE_ENABLE_ACCOUNT_LOGIN', undefined)
    const handlers = new Map<string, (...args: any[]) => void>()
    let popup!: (details: { url: string }) => { action: string }
    protectPrivilegedWindowNavigation({ webContents: {
      getURL: () => 'http://localhost:5173/',
      on: (name: string, callback: (...args: any[]) => void) => handlers.set(name, callback),
      setWindowOpenHandler: (callback: typeof popup) => { popup = callback },
    } } as unknown as BrowserWindow)
    const preventDefault = vi.fn()
    for (let i = 0; i < 25; i++) {
      handlers.get('will-navigate')!({ preventDefault }, 'http://127.0.0.1:3850/api/auth/oauth2/authorize')
      expect(popup({ url: 'http://localhost:3850/api/auth/oauth2/authorize' }).action).toBe('deny')
    }
    expect(preventDefault).toHaveBeenCalledTimes(25)
    expect(shell.openExternal).not.toHaveBeenCalled()
    popup({ url: 'https://example.com/help' })
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/help')
  })
})

const mocks = vi.hoisted(() => ({
  isMacOS: false,
  isWindows: false,
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('std-env', () => ({
  get isMacOS() {
    return mocks.isMacOS
  },
  get isWindows() {
    return mocks.isWindows
  },
}))

vi.mock('../../services/electron', () => ({
  createAppService: vi.fn(),
  createAppVersionService: vi.fn(),
  createPowerMonitorService: vi.fn(),
  createScreenService: vi.fn(),
  createSystemPreferencesService: vi.fn(),
  createWindowService: vi.fn(),
}))

describe('setWindowAlwaysOnTop', () => {
  it('disables always-on-top when flag is false', () => {
    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, false)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  it('applies standard always-on-top on Linux', () => {
    mocks.isMacOS = false
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('applies screen-saver level and relative offset on macOS', () => {
    mocks.isMacOS = true
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 1)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
  })

  it('applies screen-saver level and relative offset on Windows', () => {
    mocks.isMacOS = false
    mocks.isWindows = true

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 2)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 2)
  })
})

describe('resizeBoundsByDelta', () => {
  it('keeps the opposite corner still while a corner grip is dragged', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: -20, deltaY: -30, direction: 'nw' }))
      .toEqual({ x: 80, y: 70, width: 420, height: 530 })
    expect(resizeBoundsByDelta(bounds, { deltaX: 20, deltaY: 30, direction: 'se' }))
      .toEqual({ x: 100, y: 100, width: 420, height: 530 })
  })

  it('stops at the minimum size and keeps the opposite edges still', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: 1000, deltaY: 1000, direction: 'nw', minWidth: 300, minHeight: 250 }))
      .toEqual({ x: 200, y: 350, width: 300, height: 250 })
  })
})
