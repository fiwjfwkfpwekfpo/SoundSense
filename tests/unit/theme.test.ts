import { describe, expect, it } from 'vitest';
import { findColors } from '../../scripts/check-colors.mjs';
describe('color lint', () => {
  it.each(['color: #fff;', 'let value = "#abcdef";', 'color: rgb(1, 2, 3);', 'background: rgba(1,2,3,.2);', 'a { background: linear-gradient(black, var(--color-bg)); }', 'a { box-shadow: 0 0 8px #aabbcc; }', 'color: hsl(2,3%,4%);', 'a { color: white; }', 'a { box-shadow: 0 2px 4px black; }', 'const color = "rebeccapurple";', '<svg fill="red"></svg>'])('rejects %s', source => expect(findColors(source).length).toBeGreaterThan(0));
  it('allows semantic tokens and currentColor', () => expect(findColors('a { color: var(--color-text); border: 1px solid currentColor; }')).toEqual([]));
});
