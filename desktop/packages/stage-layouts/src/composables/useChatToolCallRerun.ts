import type { ChatToolCallRerunEvent } from '@lingbo/stage-ui/stores/tool-call-rerun'

import { useChatVision } from '@lingbo/stage-ui/composables/vision/use-chat-vision'
import { resolveLlmTools } from '@lingbo/stage-ui/stores/ai/chat-llm/tool-resolver'
import { useChatSessionStore } from '@lingbo/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@lingbo/stage-ui/stores/modules/consciousness'
import { executeToolCallRerun } from '@lingbo/stage-ui/stores/tool-call-rerun'
import { errorMessageFrom } from '@moeru/std'

export function useChatToolCallRerun() {
  const chatSession = useChatSessionStore()
  const consciousnessStore = useConsciousnessStore()
  const chatVision = useChatVision()

  /**
   * Triggering workflow: ChatHistory `toolCallRerun` -> rerunToolCall
   * -> {@link executeToolCallRerun} -> chatSession.setSessionMessages.
   */
  async function rerunToolCall(payload: ChatToolCallRerunEvent) {
    const sessionId = chatSession.activeSessionId
    const currentMessages = chatSession.getSessionMessages(sessionId)

    try {
      const nextMessages = await executeToolCallRerun({
        messages: currentMessages,
        payload: {
          sessionId,
          messageId: payload.message.id,
          index: payload.index,
          toolCallId: payload.toolCallId,
          invocationId: payload.invocationId,
          toolName: payload.toolName,
          args: payload.args,
        },
        // A rerun stores its result in history, so it reads images like a send.
        resolveTools: () => resolveLlmTools({ describeImage: chatVision.toolImageReader(consciousnessStore.activeModel) }),
      })
      chatSession.setSessionMessages(sessionId, nextMessages)
    }
    catch (error) {
      chatSession.setSessionMessages(sessionId, [
        ...currentMessages,
        {
          role: 'error',
          content: errorMessageFrom(error) ?? 'Failed to rerun tool call.',
        },
      ])
    }
  }

  return {
    rerunToolCall,
  }
}
