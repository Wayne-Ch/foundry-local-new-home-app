export class RendererOperationBarrier {
  #generation = 0;
  #resetGeneration: number | null = null;
  #resetQuarantined = false;

  get resetInFlight(): boolean {
    return this.#resetGeneration !== null;
  }

  get resetQuarantined(): boolean {
    return this.#resetQuarantined;
  }

  get operationsBlocked(): boolean {
    return this.resetInFlight || this.#resetQuarantined;
  }

  beginOperation(): number {
    return this.#generation;
  }

  isCurrentOperation(generation: number): boolean {
    return !this.operationsBlocked && generation === this.#generation;
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
    this.#resetQuarantined = false;
    return true;
  }

  failReset(generation: number): boolean {
    if (!this.isCurrentReset(generation)) {
      return false;
    }
    this.#resetGeneration = null;
    this.#resetQuarantined = true;
    return true;
  }

  releaseResetQuarantine(): boolean {
    if (!this.#resetQuarantined || this.#resetGeneration !== null) {
      return false;
    }
    this.#generation += 1;
    this.#resetQuarantined = false;
    return true;
  }
}
