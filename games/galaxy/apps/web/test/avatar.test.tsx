import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// Avatar with its pixel frame (Nov plan C2): the chosen avatar's art (an animated strip when it is one), the frame's
// art around it, and the drawing made from the name when there is no avatar or no art for it.
vi.mock('../src/profile/art', () => ({
  avatarArt: (id: string) => (id === 'crew-cat' ? { url: '/cat.png', frames: 1 } : id === 'shop-void-knight' ? { url: '/knight.png', frames: 4 } : undefined),
  frameArt: (id: string) => (id === 'gold' ? { url: '/gold.png', frames: 1 } : id === 'prism' ? { url: '/prism.png', frames: 6 } : undefined),
}));
const { Avatar } = await import('../src/hub/Avatar');

test('sin avatar se ve la figura del nombre', () => {
  const { container } = render(<Avatar name="vega" />);
  expect(container.querySelector('svg.avatar')).not.toBeNull();
  expect(container.querySelector('.avatar-art')).toBeNull();
});

test('con avatar se ve su arte, y si es animado lleva su tira', () => {
  const { container, rerender } = render(<Avatar name="vega" avatar="crew-cat" />);
  const art = container.querySelector<HTMLElement>('.avatar-art')!;
  expect(art.style.backgroundImage).toContain('/cat.png');
  expect(art).not.toHaveClass('anim');
  rerender(<Avatar name="vega" avatar="shop-void-knight" />);
  expect(container.querySelector('.avatar-art')).toHaveClass('anim');
  expect(container.querySelector<HTMLElement>('.avatar-art')!.style.getPropertyValue('--frames')).toBe('4');
});

test('un avatar sin arte cae en la figura del nombre', () => {
  const { container } = render(<Avatar name="vega" avatar="no-existe" />);
  expect(container.querySelector('svg.avatar')).not.toBeNull();
});

test('el marco se dibuja alrededor; uno sin arte queda como aro de color de su id', () => {
  const { container, rerender } = render(<Avatar name="vega" avatar="crew-cat" frame="gold" size={64} />);
  const box = container.querySelector<HTMLElement>('.avatar-box')!;
  expect(box.style.getPropertyValue('--s')).toBe('2');
  expect(container.querySelector<HTMLElement>('.avatar-frame')!.style.backgroundImage).toContain('/gold.png');
  rerender(<Avatar name="vega" frame="silver" />);
  expect(container.querySelector('.avatar-frame')).toBeNull();
  expect(container.querySelector('.avatar-box')).toHaveAttribute('data-ring', 'silver');
});
