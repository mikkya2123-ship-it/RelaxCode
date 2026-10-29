import { BLENDER_RECIPES, recipeNames } from '@shared/blender-recipes'
import { invokeTool, listStates } from './mcp'
import { isWeakModel } from './model-memory'
import { activeProvider } from './store'
import { app } from 'electron'
import type { ToolDef, ToolResult } from './tools'

/**
 * The masterpiece palette: a hand-holding layer over the connected Blender
 * server for models that have proven themselves weak tool callers (text tool
 * calls, broken JSON arguments, unknown tools — see model-memory). A strong
 * model never sees it and writes its own bpy code.
 */

function paletteEligible(): boolean {
  if (
    !listStates().some(
      (state) =>
        state.config.name === 'blender' && state.status === 'ready' && state.config.trusted && state.config.enabled
    )
  ) {
    return false
  }
  const provider = activeProvider()
  return provider.model !== null && isWeakModel(provider.baseUrl, provider.model, app.getPath('userData'))
}

const blenderRecipeTool: ToolDef = {
  name: 'blender_recipe',
  description:
    'High-level Blender scene operations — correct bpy code is generated for you, never write raw Blender Python unless a recipe is missing. Call it several times to compose a scene. Recipes: ' +
    Object.entries(BLENDER_RECIPES)
      .map(([name, recipe]) => `${name} — ${recipe.description}`)
      .join('; '),
  parameters: {
    type: 'object',
    properties: {
      recipe: {
        type: 'string',
        description: `One of: ${recipeNames().join(', ')}`
      },
      args: {
        type: 'object',
        description: 'Arguments of the recipe; omit for defaults',
        additionalProperties: true
      }
    },
    required: ['recipe']
  },
  risk: 'exec',
  execute: async (args): Promise<ToolResult> => {
    const name = typeof args.recipe === 'string' ? args.recipe.trim() : ''
    const recipe = BLENDER_RECIPES[name]
    if (!recipe) {
      return {
        ok: false,
        summary: `unknown recipe: ${name || '(empty)'}`,
        detail: `Available recipes: ${recipeNames().join(', ')}.`
      }
    }
    const recipeArgs =
      args.args && typeof args.args === 'object' && !Array.isArray(args.args)
        ? (args.args as Record<string, unknown>)
        : {}
    let code: string
    try {
      code = recipe.python(recipeArgs)
    } catch {
      return { ok: false, summary: `bad arguments for ${name}`, detail: 'Check the argument types.' }
    }
    const result = await invokeTool('blender', 'execute_blender_code', JSON.stringify({ code }))
    if (!result.ok) return { ok: false, summary: `${name} failed`, detail: result.text }
    return {
      ok: true,
      summary: `${name} ok`,
      detail: result.text.trim().length > 0 ? result.text : `The ${name} recipe ran in Blender.`
    }
  }
}

/** The palette, or nothing: strong models keep their raw tools. */
export function blenderPaletteDefs(): ToolDef[] {
  return paletteEligible() ? [blenderRecipeTool] : []
}
