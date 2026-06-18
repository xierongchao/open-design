import { describe, expect, it } from 'vitest';
import {
  emptyManualEditSourceRoundTrip,
  enterManualEditSourceRoundTrip,
  markManualEditLocalSave,
  reconcileManualEditSourceRoundTrip,
} from '../../src/components/html-editor-source-roundtrip';

describe('manual edit source round trip', () => {
  it('starts with no expected or external source', () => {
    expect(emptyManualEditSourceRoundTrip()).toEqual({
      expectedSource: null,
      externalSource: null,
    });
  });

  it('captures the current source when fallback edit starts', () => {
    expect(enterManualEditSourceRoundTrip('<html>start</html>')).toEqual({
      expectedSource: '<html>start</html>',
      externalSource: null,
    });
  });

  it('marks local saves as expected source round trips', () => {
    expect(markManualEditLocalSave({
      expectedSource: '<html>before</html>',
      externalSource: '<html>external</html>',
    }, '<html>saved</html>')).toEqual({
      expectedSource: '<html>saved</html>',
      externalSource: null,
    });
  });

  it('ignores local save round trips while keeping the frozen iframe document stable', () => {
    const state = markManualEditLocalSave(
      enterManualEditSourceRoundTrip('<html>before</html>'),
      '<html>saved</html>',
    );

    expect(reconcileManualEditSourceRoundTrip(state, '<html>saved</html>')).toEqual({
      next: state,
      shouldAdvanceFrozenSource: false,
      externalRewrite: false,
    });
  });

  it('advances the frozen source for an external rewrite', () => {
    const state = enterManualEditSourceRoundTrip('<html>before</html>');

    expect(reconcileManualEditSourceRoundTrip(state, '<html>external</html>')).toEqual({
      next: {
        expectedSource: '<html>external</html>',
        externalSource: '<html>external</html>',
      },
      shouldAdvanceFrozenSource: true,
      externalRewrite: true,
    });
  });
});
