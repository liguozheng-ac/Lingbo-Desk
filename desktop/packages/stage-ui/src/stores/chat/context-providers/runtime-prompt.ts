import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@lingbo/server-sdk'
import { nanoid } from 'nanoid'

const RUNTIME_PROMPT_CONTEXT_ID = 'system:lingbo-runtime-prompt'

/** Creates a user-role context for the current runtime prompt. */
export function createRuntimePromptContext(prompt: string): ContextMessage | undefined {
  if (!prompt)
    return undefined

  return {
    id: nanoid(),
    contextId: RUNTIME_PROMPT_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    metadata: {
      source: { id: RUNTIME_PROMPT_CONTEXT_ID },
    },
    text: prompt,
    createdAt: Date.now(),
  }
}
