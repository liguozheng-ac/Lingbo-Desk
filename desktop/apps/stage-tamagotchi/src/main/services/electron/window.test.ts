import type { Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { bounds, startLoopGetBounds } from '@lingbo/electron-eventa'
import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWindowService } from './window'

vi.mock('electron', () => ({ shell: {} }))
// The test targets bounds dispatch; it does not construct unrelated native services.
vi.mock('../../windows/shared/window', () => ({ resizeWindowByDelta: vi.fn(), setWindowAlwaysOnTop: vi.fn() }))

class FakeWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, isCrashed: () => false })
  rectangle = { x: 10, y: 20, width: 600, height: 800 }
  visible = true
  isDestroyed() { return false }
  isVisible() { return this.visible }
  getBounds() { return this.rectangle }
}

function setupWindow() {
  const context = createContext()
  const window = new FakeWindow()
  createWindowService({ context: context as never, window: window as never })
  const sent: Rectangle[] = []
  context.on(bounds, event => sent.push({ ...event.body! }))
  return { sent, window, startLoop: defineInvoke(context, startLoopGetBounds) }
}

describe('window bounds dispatch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sends a stationary snapshot once while preserving movement and resize updates', async () => {
    const { sent, window, startLoop } = setupWindow()
    try {
      await startLoop()
      await vi.advanceTimersByTimeAsync(500)
      expect(sent).toEqual([{ x: 10, y: 20, width: 600, height: 800 }])
      window.rectangle.x = 11
      await vi.advanceTimersByTimeAsync(100)
      window.rectangle.height = 900
      await vi.advanceTimersByTimeAsync(100)
      expect(sent).toEqual([
        { x: 10, y: 20, width: 600, height: 800 },
        { x: 11, y: 20, width: 600, height: 800 },
        { x: 11, y: 20, width: 600, height: 900 },
      ])
    }
    finally { window.emit('closed') }
  })

  it('resends the snapshot to a reloaded page and stops sending when closed', async () => {
    const { sent, window, startLoop } = setupWindow()
    await startLoop()
    await vi.advanceTimersByTimeAsync(100)
    await startLoop()
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    window.emit('closed')
    window.rectangle.width = 700
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toHaveLength(2)
  })
})
