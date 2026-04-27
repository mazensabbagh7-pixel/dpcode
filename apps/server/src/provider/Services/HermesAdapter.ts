/**
 * HermesAdapter - Hermes Agent implementation of the generic provider adapter contract.
 *
 * Hermes is intentionally executed on its existing Mac Mini installation so
 * its skills, tools, memory, auth, and session state remain there.
 *
 * @module HermesAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface HermesAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "hermes";
}

export class HermesAdapter extends ServiceMap.Service<HermesAdapter, HermesAdapterShape>()(
  "t3/provider/Services/HermesAdapter",
) {}
