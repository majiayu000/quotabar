import { useEffect, useState } from 'react';

export interface LatestRequestGeneration {
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGeneration(): LatestRequestGeneration {
  let current_generation = 0;

  return {
    begin() {
      current_generation += 1;
      return current_generation;
    },
    isCurrent(generation) {
      return generation === current_generation;
    },
    invalidate() {
      current_generation += 1;
    },
  };
}

export function useLatestRequestGeneration(): LatestRequestGeneration {
  const [request_generation] = useState(createLatestRequestGeneration);

  useEffect(() => () => request_generation.invalidate(), [request_generation]);

  return request_generation;
}
