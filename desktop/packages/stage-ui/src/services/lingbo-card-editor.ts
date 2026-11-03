import type { Card } from '@lingbo/ccc'

import type { LingboExtension } from '../types/lingboCard'

import {
  check,
  nonEmpty,
  object,
  objectWithRest,
  parseJson,
  pipe,
  regex,
  safeParse,
  string,
  trim,
  unknown,
} from 'valibot'

export type LingboCardDraftValidationError = 'name' | 'version' | 'invalid_artistry_json'

/** Module settings owned by the LINGBO Card editor form. */
interface LingboCardEditorModules {
  consciousness: LingboExtension['modules']['consciousness']
  vision: LingboExtension['modules']['vision']
  speech: Pick<LingboExtension['modules']['speech'], 'provider' | 'model' | 'voice_id'>
  artistry: Pick<
    NonNullable<LingboExtension['modules']['artistry']>,
    | 'provider'
    | 'model'
    | 'promptPrefix'
    | 'widgetInstruction'
    | 'spawnMode'
    | 'options'
    | 'autonomousEnabled'
    | 'autonomousThreshold'
  >
}

/**
 * Reads the module fields that the LINGBO Card editor owns.
 *
 * Empty strings mean that the card inherits the corresponding global setting.
 */
export function getLingboCardEditorModuleSettings(
  card: Card | undefined,
): Pick<LingboCardEditorModules, 'consciousness' | 'vision' | 'speech'> & { displayModelId: string } {
  const extension = isLingboExtension(card?.extensions?.lingbo) ? card.extensions.lingbo : undefined
  const modules = getLingboCardModules(extension)

  return {
    consciousness: {
      provider: getModuleString(modules?.consciousness, 'provider'),
      model: getModuleString(modules?.consciousness, 'model'),
    },
    vision: {
      provider: getModuleString(modules?.vision, 'provider'),
      model: getModuleString(modules?.vision, 'model'),
    },
    speech: {
      provider: getModuleString(modules?.speech, 'provider'),
      model: getModuleString(modules?.speech, 'model'),
      voice_id: getModuleString(modules?.speech, 'voice_id'),
    },
    displayModelId: extension?.avatarModels?.find(model => model.id === extension.defaultAvatarModelId)?.displayModelId ?? '',
  }
}

type CardWithLingboExtension = Card & {
  extensions: NonNullable<Card['extensions']> & {
    lingbo: LingboExtension
  }
}

export type LingboCardDraftValidationResult
  = | {
    success: true
    output: {
      card: Card
      artistryOptions: Record<string, unknown> | undefined
    }
  }
  | {
    success: false
    error: LingboCardDraftValidationError
  }

const cardDraftSchema = object({
  name: pipe(string(), trim(), nonEmpty()),
  version: pipe(string(), trim(), regex(/^(?:\d+\.)+\d+$/)),
})

const artistryOptionsSchema = pipe(
  string(),
  trim(),
  parseJson(),
  check(isRecord),
  objectWithRest({}, unknown()),
)

/**
 * Validates and normalizes the fields owned by the LINGBO Card editor.
 *
 * Display text remains untouched except for boundary whitespace on the
 * required name and version fields. Artistry options must be a JSON object
 * when present.
 */
export function safeParseLingboCardDraft(card: Card, artistryOptionsJson: string): LingboCardDraftValidationResult {
  const cardResult = safeParse(cardDraftSchema, card)
  if (!cardResult.success) {
    const invalidField = cardResult.issues[0]?.path?.[0]?.key
    return {
      success: false,
      error: invalidField === 'version' ? 'version' : 'name',
    }
  }

  const normalizedArtistryOptions = artistryOptionsJson.trim()
  if (!normalizedArtistryOptions) {
    return {
      success: true,
      output: {
        card: { ...card, ...cardResult.output },
        artistryOptions: undefined,
      },
    }
  }

  const artistryResult = safeParse(artistryOptionsSchema, normalizedArtistryOptions)
  if (!artistryResult.success) {
    return {
      success: false,
      error: 'invalid_artistry_json',
    }
  }

  return {
    success: true,
    output: {
      card: { ...card, ...cardResult.output },
      artistryOptions: artistryResult.output,
    },
  }
}

/**
 * Applies editor-owned module fields to a complete character card.
 *
 * The returned card preserves extension fields the form cannot display,
 * including body models, backgrounds, advanced speech/artistry settings, and
 * agent configuration.
 */
export function applyLingboCardEditorModules(
  card: Card,
  edited: LingboCardEditorModules,
): CardWithLingboExtension {
  const existing = isLingboExtension(card.extensions?.lingbo)
    ? card.extensions.lingbo
    : undefined
  const existingModules = { ...existing?.modules }
  Reflect.deleteProperty(existingModules, 'displayModelId')

  return {
    ...card,
    extensions: {
      ...card.extensions,
      lingbo: {
        ...existing,
        avatarModels: existing?.avatarModels ?? [],
        modules: {
          ...existingModules,
          consciousness: edited.consciousness,
          vision: edited.vision,
          speech: {
            ...existing?.modules.speech,
            ...edited.speech,
          },
          artistry: {
            ...existing?.modules.artistry,
            ...edited.artistry,
          },
        },
        agents: existing?.agents ?? {},
      },
    },
  }
}

function isLingboExtension(value: unknown): value is LingboExtension {
  return isRecord(value)
    && isRecord(value.modules)
    && isRecord(value.agents)
}

function getLingboCardModules(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.modules))
    return undefined

  return value.modules
}

function getModuleString(module: unknown, key: string): string {
  if (!isRecord(module))
    return ''

  const value = module[key]
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
