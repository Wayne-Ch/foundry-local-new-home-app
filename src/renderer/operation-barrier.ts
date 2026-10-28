export class RendererOperationBarrier {
  #generation = 0;
  #resetGeneration: number | null = null;

  get resetInFlight(): boolean {
    return this.#resetGeneration !== null;
  }

  beginOperation(): number {
    return this.#generation;
  }

  isCurrentOperation(generation: number): boolean {
    return this.#resetGeneration === null && generation === this.#generation;
  }

  beginReset(): number {
    if (this.#resetGeneration !== null) {
      return this.#resetGeneration;
    }
    this.#generation += 1;
    this.#resetGeneration = this.#generation;
    return this.#resetGeneration;
  }

  isCurrentReset(generation: number): boolean {
    return this.#resetGeneration === generation && generation === this.#generation;
  }

  finishReset(generation: number): boolean {
    if (!this.isCurrentReset(generation)) {
      return false;
    }
    this.#resetGeneration = null;
    return true;
  }
}
