import { StageEnvironment } from '@lingbo/stage-shared'
import {
  beatSyncBeatSignaledInvokeEventa,
  beatSyncGetInputByteFrequencyDataInvokeEventa,
  beatSyncGetStateInvokeEventa,
  beatSyncStateChangedInvokeEventa,
  beatSyncToggleInvokeEventa,
  beatSyncUpdateParametersInvokeEventa,
  createBeatSyncDetector,
  createContext,
} from '@lingbo/stage-shared/beat-sync'
import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'

const context = createContext()
const signalState = defineInvoke(context, beatSyncStateChangedInvokeEventa)
const signalBeat = defineInvoke(context, beatSyncBeatSignaledInvokeEventa)
const detector = createBeatSyncDetector({ env: StageEnvironment.Tamagotchi })

detector.on('stateChange', state => void signalState(state))
detector.on('beat', event => void signalBeat(event))

defineInvokeHandler(context, beatSyncToggleInvokeEventa, async (enabled) => {
  if (enabled)
    await detector.startScreenCapture()
  else
    detector.stop()
})
defineInvokeHandler(context, beatSyncGetStateInvokeEventa, async () => detector.state)
defineInvokeHandler(context, beatSyncUpdateParametersInvokeEventa, async params => detector.updateParameters(params))
defineInvokeHandler(context, beatSyncGetInputByteFrequencyDataInvokeEventa, async () => detector.getInputByteFrequencyData())
