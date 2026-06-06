import { embed }             from "ai"
import { vectorSearch }      from "./vector"
import { keywordSearch }     from "./keyword"
import { rrfFusion }         from "./rrf"
import { applyRecencyBoost, applyTitleBoost, recordAccess, getPromoteSignals } from "./boosts"
import { applyGraphSignals } from "./graph"
import { stampEvidence }     from "./evidence"
import { checkQueryCache, saveToCache } from "./cache"
import type { StampedResult } from "./evidence"
import type { PromoteCandidate } from "./boosts"

let _embeddingModel: Parameters<typeof embed>[0]["model"] | null = null

export function setSearchEmbeddingModel(model: Parameters<typeof embed>[0]["model"]) {
  _embeddingModel = model
}

const SCORE_THRESHOLD = 0.01

export interface SearchOpts {
  layer?:    number | null  // null = cascade L2→L1→L0
  limit?:    number
  source_id?: string
}

export interface BrainSearchResult {
  results:          StampedResult[]
  layer_reached:    number
  cascaded:         boolean
  layers_searched:  number[]
  promote_signals:  PromoteCandidate[]
  from_cache:       boolean
}

async function searchOneLayer(
  queryVec:  number[] | null,
  query:     string,
  layer:     number,
  sourceId:  string,
  limit:     number,
): Promise<StampedResult[]> {
  const [vecResults, kwResults] = await Promise.all([
    queryVec ? vectorSearch(queryVec, layer, sourceId, limit) : Promise.resolve([]),
    keywordSearch(query, layer, sourceId, limit),
  ])

  let fused = rrfFusion(vecResults, kwResults)
  fused = await applyRecencyBoost(fused)
  fused = applyTitleBoost(fused, query)
  fused = await applyGraphSignals(fused)
  return stampEvidence(fused, query)
}

export async function brainSearch(query: string, opts: SearchOpts = {}): Promise<BrainSearchResult> {
  const sourceId = opts.source_id ?? "default"
  const limit    = opts.limit     ?? 10
  const fixedLayer = opts.layer !== undefined ? opts.layer : null

  // Cache check
  const cached = await checkQueryCache(query, fixedLayer, sourceId)
  if (cached) {
    return {
      results:         cached,
      layer_reached:   cached[0]?.layer ?? -1,
      cascaded:        false,
      layers_searched: fixedLayer !== null ? [fixedLayer] : [2, 1, 0],
      promote_signals: [],
      from_cache:      true,
    }
  }

  // Embed query (if model available)
  let queryVec: number[] | null = null
  if (_embeddingModel) {
    try {
      const { embedding } = await embed({ model: _embeddingModel, value: query })
      queryVec = embedding
    } catch {}
  }

  // Fixed layer search
  if (fixedLayer !== null) {
    const results = await searchOneLayer(queryVec, query, fixedLayer, sourceId, limit)
    await recordAccess(results.map((r) => r.slug), query)
    await saveToCache(query, fixedLayer, sourceId, results)
    const promote = await getPromoteSignals(results.map((r) => r.slug))
    return {
      results, layer_reached: fixedLayer, cascaded: false,
      layers_searched: [fixedLayer], promote_signals: promote, from_cache: false,
    }
  }

  // Cascade: L2 → L1 → L0
  const layersSearched: number[] = []
  for (const layer of [2, 1, 0]) {
    layersSearched.push(layer)
    const results = await searchOneLayer(queryVec, query, layer, sourceId, limit)

    if (results.length > 0 && results[0].score >= SCORE_THRESHOLD) {
      await recordAccess(results.map((r) => r.slug), query)
      await saveToCache(query, null, sourceId, results)
      const promote = layer === 0
        ? await getPromoteSignals(results.map((r) => r.slug))
        : []
      return {
        results, layer_reached: layer, cascaded: layer < 2,
        layers_searched: layersSearched, promote_signals: promote, from_cache: false,
      }
    }
  }

  // Nothing found — return empty L0 results
  const fallback = await searchOneLayer(queryVec, query, 0, sourceId, limit)
  return {
    results: fallback, layer_reached: fallback.length ? 0 : -1, cascaded: true,
    layers_searched: [2, 1, 0],
    promote_signals: await getPromoteSignals(fallback.map((r) => r.slug)),
    from_cache: false,
  }
}
