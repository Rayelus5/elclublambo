import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { expect, test } from 'vitest';
import { useClaimFx } from '../src/missions/ClaimFx';
import type { Reward } from '../src/missions/ready';

// The reward flying to the wallet: event signals fly as their own purple ticket (to the event ticket of the wallet),
// never as normal signals, whose counter they do not raise.

function Burst({ reward }: { reward: Reward }) {
  const { burst, view } = useClaimFx(false);
  useEffect(() => burst(document.body, reward), [burst, reward]);
  return view;
}

test('las señales de evento vuelan como su propio ticket y las normales como el suyo', () => {
  act(() => {
    render(<Burst reward={{ eventSignals: 3 }} />);
  });
  expect(document.querySelectorAll('.claim-chip.event-signal').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.claim-chip.signal')).toHaveLength(0);
});

test('una meta que da de las dos hace volar los dos tickets', () => {
  act(() => {
    render(<Burst reward={{ signal: 1, eventSignals: 2 }} />);
  });
  expect(document.querySelectorAll('.claim-chip.event-signal').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.claim-chip.signal').length).toBeGreaterThan(0);
});
