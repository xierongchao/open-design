export interface ManualEditSourceRoundTrip {
  expectedSource: string | null;
  externalSource: string | null;
}

export interface ManualEditSourceReconcileResult {
  next: ManualEditSourceRoundTrip;
  shouldAdvanceFrozenSource: boolean;
  externalRewrite: boolean;
}

export function emptyManualEditSourceRoundTrip(): ManualEditSourceRoundTrip {
  return {
    expectedSource: null,
    externalSource: null,
  };
}

export function enterManualEditSourceRoundTrip(currentSource: string | null): ManualEditSourceRoundTrip {
  return {
    expectedSource: currentSource,
    externalSource: null,
  };
}

export function markManualEditLocalSave(
  current: ManualEditSourceRoundTrip,
  savedSource: string,
): ManualEditSourceRoundTrip {
  return {
    ...current,
    expectedSource: savedSource,
    externalSource: null,
  };
}

export function reconcileManualEditSourceRoundTrip(
  current: ManualEditSourceRoundTrip,
  latestSource: string | null,
): ManualEditSourceReconcileResult {
  if (latestSource === current.expectedSource && current.externalSource !== latestSource) {
    return {
      next: current,
      shouldAdvanceFrozenSource: false,
      externalRewrite: false,
    };
  }

  if (latestSource !== current.expectedSource) {
    return {
      next: {
        expectedSource: latestSource,
        externalSource: latestSource,
      },
      shouldAdvanceFrozenSource: true,
      externalRewrite: true,
    };
  }

  return {
    next: current,
    shouldAdvanceFrozenSource: true,
    externalRewrite: false,
  };
}
